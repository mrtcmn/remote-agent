import { Elysia } from 'elysia';

export const CODE_PREFIX = '/code';

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host',
]);

interface Opts {
  /** code-server's loopback port. */
  port: number;
  /** Returns the user id, or null to refuse. */
  authorize: (request: Request, address?: string) => Promise<string | null>;
  /** Called on every proxied request — keeps code-server's idle timer alive. */
  onActivity?: () => void;
}

interface Bridge { up: WebSocket; queue: (string | Uint8Array)[] }
// Elysia makes a new wrapper per event; the raw Bun socket is the stable key.
const bridges = new Map<object, Bridge>();
const key = (ws: { raw?: object }) => (ws.raw as object) ?? (ws as object);

export function codeProxy(opts: Opts) {
  const target = `127.0.0.1:${opts.port}`;
  const strip = (pathname: string) => pathname.slice(CODE_PREFIX.length) || '/';

  return new Elysia({ name: 'code-proxy' })
    // HTTP is handled before routing, so the SPA catch-all never sees it.
    .onRequest(async ({ request, server }) => {
      const url = new URL(request.url);
      if (url.pathname !== CODE_PREFIX && !url.pathname.startsWith(`${CODE_PREFIX}/`)) return;
      if (url.pathname.startsWith(`${CODE_PREFIX}/m/`)) return; // Task 4: another machine
      if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') return; // .ws below

      const address = server?.requestIP(request)?.address;
      if (!(await opts.authorize(request, address))) return new Response('Unauthorized', { status: 401 });
      opts.onActivity?.();

      const headers = new Headers();
      request.headers.forEach((v, k) => { if (!HOP_BY_HOP.has(k.toLowerCase())) headers.set(k, v); });
      try {
        // decompress:false keeps code-server's gzip; redirect:manual keeps its relative redirects.
        const res = await fetch(`http://${target}${strip(url.pathname)}${url.search}`, {
          method: request.method,
          headers,
          body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
          redirect: 'manual',
          decompress: false,
        } as RequestInit);
        const out = new Headers();
        res.headers.forEach((v, k) => { if (!HOP_BY_HOP.has(k.toLowerCase())) out.set(k, v); });
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
      } catch (err) {
        return new Response(`code-server unreachable: ${(err as Error).message}`, { status: 502 });
      }
    })
    .ws(`${CODE_PREFIX}/*`, {
      idleTimeout: 960,
      async beforeHandle({ request, server, set }) {
        if (!(await opts.authorize(request, server?.requestIP(request)?.address))) {
          set.status = 401;
          return 'Unauthorized';
        }
      },
      open(ws) {
        const req = ws.data.request;
        const url = new URL(req.url);
        const protocols = req.headers.get('sec-websocket-protocol')?.split(',').map((p) => p.trim()) ?? [];
        const up = new WebSocket(`ws://${target}${strip(url.pathname)}${url.search}`, protocols);
        up.binaryType = 'arraybuffer';
        const bridge: Bridge = { up, queue: [] };
        bridges.set(key(ws), bridge);
        const raw = ws.raw as { send(d: string | Uint8Array): void };
        up.onopen = () => { for (const m of bridge.queue) up.send(m); bridge.queue = []; };
        // raw.send: Elysia's ws.send would JSON-encode binary frames.
        up.onmessage = (e) => raw.send(typeof e.data === 'string' ? e.data : new Uint8Array(e.data as ArrayBuffer));
        up.onclose = (e) => { try { ws.close(e.code || 1000, e.reason); } catch {} };
        up.onerror = () => { try { ws.close(1011, 'upstream error'); } catch {} };
      },
      message(ws, message) {
        const bridge = bridges.get(key(ws));
        if (!bridge) return;
        opts.onActivity?.();
        // Elysia parses JSON-looking text into objects; turn those back into text.
        const data = typeof message === 'string' ? message
          : message instanceof ArrayBuffer ? new Uint8Array(message)
          : message instanceof Uint8Array ? message
          : JSON.stringify(message);
        if (bridge.up.readyState === WebSocket.OPEN) bridge.up.send(data);
        else bridge.queue.push(data);
      },
      close(ws) {
        const bridge = bridges.get(key(ws));
        bridges.delete(key(ws));
        try { bridge?.up.close(); } catch {}
      },
    });
}
