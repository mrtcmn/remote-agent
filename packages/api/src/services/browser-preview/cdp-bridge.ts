import type { Server, ServerWebSocket } from 'bun';

/** The proxy path on the desktop's API that leads to its browser panel's CDP port. */
export const PANEL_CDP_PREFIX = '/panel-cdp';

interface Channel { send(d: string | Uint8Array): void; close(code?: number, reason?: string): void }
interface Handlers { message: (d: string | Uint8Array) => void; close: (code: number, reason: string) => void }

export interface BridgeDeps<V> {
  port: number;
  /** The desktop that shows a browser panel now; null = none. */
  viewer: () => V | null;
  fetch: (viewer: V, path: string) => Promise<Response>;
  openWs: (viewer: V, path: string, handlers: Handlers) => Channel | Promise<Channel>;
}

interface Sock { path: string; up: Channel | null; queue: (string | Uint8Array)[]; closed: boolean }

/**
 * A CDP endpoint on loopback, for the agent's `agent-browser --cdp <port>`.
 * The browser itself is the panel in the user's desktop app on another machine;
 * every request goes there. The port is never published.
 */
export function startCdpBridge<V>(deps: BridgeDeps<V>): Server<Sock> {
  const none = () => new Response('No desktop app is viewing a browser panel', { status: 503 });

  const server: Server<Sock> = Bun.serve<Sock, never>({
    hostname: '127.0.0.1',
    port: deps.port,
    async fetch(req, srv) {
      const url = new URL(req.url);
      const path = `${PANEL_CDP_PREFIX}${url.pathname}${url.search}`;
      if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        return srv.upgrade(req, { data: { path, up: null, queue: [], closed: false } })
          ? undefined as never
          : new Response('Upgrade failed', { status: 400 });
      }
      const viewer = deps.viewer();
      if (!viewer) return none();
      try {
        const res = await deps.fetch(viewer, path);
        // /json/* names the desktop's own port; the agent must come back to ours.
        const text = (await res.text()).replace(/(127\.0\.0\.1|localhost):\d+/g, `127.0.0.1:${server.port}`);
        return new Response(text, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' } });
      } catch (err) {
        return new Response(`Desktop app unreachable: ${(err as Error).message}`, { status: 502 });
      }
    },
    websocket: {
      // CDP frames carry screenshots.
      maxPayloadLength: 256 * 1024 * 1024,
      idleTimeout: 960,
      async open(ws: ServerWebSocket<Sock>) {
        const viewer = deps.viewer();
        if (!viewer) return ws.close(1013, 'No desktop app is viewing a browser panel');
        try {
          const up = await deps.openWs(viewer, ws.data.path, {
            message: (d) => { try { ws.send(d); } catch { /* agent gone */ } },
            close: (code, reason) => { ws.data.closed = true; try { ws.close(code || 1000, reason); } catch { /* closed */ } },
          });
          if (ws.data.closed) return up.close();
          ws.data.up = up;
          for (const m of ws.data.queue) up.send(m);
          ws.data.queue = [];
        } catch (err) {
          ws.close(1011, (err as Error).message.slice(0, 100));
        }
      },
      message(ws, message) {
        const data = typeof message === 'string' ? message : new Uint8Array(message);
        if (ws.data.up) ws.data.up.send(data);
        else ws.data.queue.push(data);
      },
      close(ws) {
        if (ws.data.closed) return;
        ws.data.closed = true;
        try { ws.data.up?.close(1000, 'Agent closed'); } catch { /* closed */ }
      },
    },
  });
  return server;
}
