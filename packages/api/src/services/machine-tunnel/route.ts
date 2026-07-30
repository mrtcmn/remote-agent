import { Elysia, t } from 'elysia';
import { machineRegistry } from '../machine-registry';
import { machineTunnel, type TunnelSocket } from './server';
import { decodeFrame } from './protocol';

const SWEEP_INTERVAL_MS = 20_000;

/**
 * Master side of the tunnel: a paired secondary connects here and holds the
 * socket open. The master then reaches it via `machineTunnel.fetch/openWs`.
 *
 * Elysia builds a NEW wrapper object per ws event, so per-connection state is
 * keyed off `ws.raw` (stable) — same pattern as machine-proxy.ts.
 */
const sockets = new Map<object, { machineId: string; socket: TunnelSocket }>();

function key(ws: { raw?: object }): object {
  return (ws.raw as object) ?? (ws as object);
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;
function ensureSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => machineTunnel.sweep(), SWEEP_INTERVAL_MS);
}

/** Bearer header first (Bun's WS client can set headers); ?token= as fallback. */
function extractToken(headers: Headers, url: URL): string | null {
  const auth = headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const value = auth.slice(7).trim();
    if (value) return value;
  }
  return url.searchParams.get('token');
}

export const machineTunnelRoute = new Elysia({ name: 'machine-tunnel-route' })
  .ws('/ws/machine-tunnel', {
    query: t.Object({ token: t.Optional(t.String()) }),

    async open(ws) {
      const request = ws.data.request;
      const token = extractToken(request.headers, new URL(request.url));
      const machine = token ? await machineRegistry.findByToken(token) : null;

      if (!machine) {
        ws.close(4401, 'Unauthorized');
        return;
      }

      // Send through the RAW Bun socket, not the ElysiaWS wrapper. Elysia
      // builds a new wrapper per event and the one captured here goes stale as
      // soon as `open` returns — and unlike the proxy, the tunnel sends
      // unsolicited frames later, outside any event callback.
      const raw = (ws.raw ?? ws) as {
        send(data: string): void;
        close(code?: number, reason?: string): void;
      };
      const socket: TunnelSocket = {
        send: (data) => { raw.send(data); },
        close: (code, reason) => { try { raw.close(code, reason); } catch { /* gone */ } },
      };

      sockets.set(key(ws), { machineId: machine.id, socket });
      machineTunnel.register(machine.id, socket);
      // A live socket is a better liveness signal than the 30s poll ever was.
      await machineRegistry.recordHeartbeat(machine.id, { sessionCount: 0 });
      ensureSweep();
    },

    message(ws, message) {
      const entry = sockets.get(key(ws));
      if (!entry) return;
      const conn = machineTunnel.connection(entry.machineId, entry.socket);
      if (!conn) return;

      machineTunnel.handleFrame(conn, message);

      // Persist heartbeat stats so the existing `machines` row (and the
      // Settings UI reading it) stays accurate. Kept out of server.ts so that
      // stays pure and unit-testable without a database.
      const frame = decodeFrame(message);
      if (frame?.t === 'heartbeat') {
        machineRegistry
          .recordHeartbeat(entry.machineId, {
            sessionCount: frame.sessionCount,
            version: frame.version,
          })
          .catch((err) => console.error('[machine-tunnel] heartbeat persist failed:', err));
      }
    },

    close(ws) {
      const k = key(ws);
      const entry = sockets.get(k);
      sockets.delete(k);
      if (entry) machineTunnel.unregister(entry.machineId, entry.socket);
    },
  });
