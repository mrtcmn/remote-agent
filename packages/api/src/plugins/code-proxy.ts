import { Elysia } from 'elysia';
import { machineFetch, type MachineTarget } from '../services/machines/resolve';
import { openSocketUpstream, openTunnelUpstream, type WsBridge } from './machine-proxy';

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
  /** Finds another machine. Without it, /code/m/<machine>/ answers 404. */
  resolve?: (machineId: string, userId: string) => Promise<MachineTarget | null>;
}

/** /code/m/<machineId>/<rest> → the same /code/<rest> on that machine. */
const REMOTE = /^\/code\/m\/([^/]+)(\/.*)?$/;
const protocolsOf = (request: Request) =>
  request.headers.get('sec-websocket-protocol')?.split(',').map((p) => p.trim()).filter(Boolean) ?? [];

// Bridges to other machines, keyed like `bridges`.
const remoteBridges = new Map<object, WsBridge>();

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
      if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') return; // .ws below

      const address = server?.requestIP(request)?.address;
      const userId = await opts.authorize(request, address);
      if (!userId) return new Response('Unauthorized', { status: 401 });

      const headers = new Headers();
      request.headers.forEach((v, k) => { if (!HOP_BY_HOP.has(k.toLowerCase())) headers.set(k, v); });

      // Another machine: the same path there, over whichever transport reaches it.
      const remote = url.pathname.match(REMOTE);
      if (remote) {
        const target = await opts.resolve?.(remote[1], userId);
        if (!target) return new Response('Unknown or unreachable machine', { status: 404 });
        // Our own login must not travel; machineFetch adds the machine's bearer.
        headers.delete('cookie');
        headers.delete('authorization');
        headers.delete('content-length');
        try {
          const res = await machineFetch(target, `${CODE_PREFIX}${remote[2] ?? '/'}${url.search}`, {
            method: request.method,
            headers,
            body: request.method === 'GET' || request.method === 'HEAD' ? null : new Uint8Array(await request.arrayBuffer()),
            timeoutMs: 60_000,
            raw: true,
          });
          const out = new Headers();
          res.headers.forEach((v, k) => { if (!HOP_BY_HOP.has(k.toLowerCase())) out.set(k, v); });
          return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
        } catch (err) {
          return new Response(`Machine unreachable: ${(err as Error).message}`, { status: 502 });
        }
      }

      opts.onActivity?.();
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
    // Declared before the local route: /code/m/<machine>/... must not reach code-server here.
    .ws(`${CODE_PREFIX}/m/:machineId/*`, {
      idleTimeout: 960,
      async beforeHandle({ request, server, set }) {
        if (!(await opts.authorize(request, server?.requestIP(request)?.address))) {
          set.status = 401;
          return 'Unauthorized';
        }
      },
      async open(ws) {
        const req = ws.data.request;
        const url = new URL(req.url);
        const remote = url.pathname.match(REMOTE);
        const userId = await opts.authorize(req, ws.remoteAddress);
        const target = remote && userId ? await opts.resolve?.(remote[1], userId) : null;
        if (!remote || !target) {
          ws.close(4404, 'Unknown or unreachable machine');
          return;
        }
        const state: WsBridge = { upstream: null, buffered: [], closed: false };
        remoteBridges.set(key(ws), state);
        const raw = ws.raw as { send(d: string | Uint8Array): void };
        const toClient = {
          message: (d: string | Uint8Array) => { try { raw.send(d); } catch {} },
          close: (code: number, reason: string) => {
            state.closed = true;
            try { ws.close(code || 1000, reason); } catch {}
          },
        };
        const path = `${CODE_PREFIX}${remote[2] ?? '/'}${url.search}`;
        try {
          state.upstream = target.kind === 'tunnel'
            ? openTunnelUpstream(target.machineId, path, toClient, protocolsOf(req))
            : openSocketUpstream(target, path, state, toClient, protocolsOf(req));
        } catch (err) {
          toClient.close(1011, (err as Error).message);
          return;
        }
        for (const m of state.buffered) state.upstream.send(m);
        state.buffered = [];
      },
      message(ws, message) {
        const state = remoteBridges.get(key(ws));
        if (!state) return;
        const data = typeof message === 'string' ? message
          : message instanceof ArrayBuffer ? new Uint8Array(message)
          : message instanceof Uint8Array ? message
          : JSON.stringify(message);
        if (state.upstream && state.ready !== false) state.upstream.send(data);
        else state.buffered.push(data);
      },
      close(ws) {
        const state = remoteBridges.get(key(ws));
        remoteBridges.delete(key(ws));
        if (state && !state.closed) {
          state.closed = true;
          try { state.upstream?.close(1000, 'Client closed'); } catch {}
        }
      },
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
        const up = new WebSocket(`ws://${target}${strip(url.pathname)}${url.search}`, protocolsOf(req));
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
