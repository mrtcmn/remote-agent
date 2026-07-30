import { Elysia, t } from 'elysia';
import { auth } from '../auth';
import { resolveMachine, machineFetch, type MachineTarget } from '../services/machines/resolve';
import { machineTunnel } from '../services/machine-tunnel/server';
import { machineRegistry } from '../services/machine-registry';

const HEADER_NAME = 'x-machine-id';
const QUERY_NAME = 'machineId';

/** Transport-agnostic far end of a bridged WebSocket. */
interface Upstream {
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

interface WsBridge {
  upstream: Upstream | null;
  buffered: (string | Uint8Array)[];
  closed: boolean;
  /** false while a URL-based upstream is still connecting; undefined for tunnels. */
  ready?: boolean;
}

/**
 * Identify the caller by cookie session or machineToken bearer. The bearer case
 * is what lets a peer open a relayed WebSocket through its hub.
 */
async function resolveCallerUserId(headers: Headers): Promise<string | null> {
  const session = await auth.api.getSession({ headers });
  if (session) return session.user.id;

  const authHeader = headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const machine = await machineRegistry.findByToken(authHeader.slice(7).trim());
    if (machine) return machine.ownerUserId;
  }
  return null;
}

// Keyed by the raw Bun ServerWebSocket, which is stable across Elysia's
// per-event wrapper instances. Using a Map (not WeakMap) is fine — we clear
// on close().
const wsBridges = new Map<object, WsBridge>();

function wsKey(ws: { raw?: object }): object {
  // Fall back to the wrapper itself if `raw` isn't exposed (shouldn't happen
  // on Bun adapter, but guards against future Elysia changes).
  return (ws.raw as object) ?? (ws as object);
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

function pickMachineId(url: URL, headers: Headers): string | null {
  const fromHeader = headers.get(HEADER_NAME);
  if (fromHeader && fromHeader !== 'self') return fromHeader;
  const fromQuery = url.searchParams.get(QUERY_NAME);
  if (fromQuery && fromQuery !== 'self') return fromQuery;
  return null;
}

function buildForwardHeaders(source: Headers): Headers {
  const out = new Headers();
  source.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    if (lower === 'authorization') return;     // machineFetch sets the bearer
    if (lower === 'cookie') return;            // master uses its own session cookies
    if (lower === HEADER_NAME) return;         // consumed by this plugin
    if (lower === 'accept-encoding') return;   // machineFetch forces identity
    out.set(key, value);
  });
  return out;
}

/**
 * Short-circuits any request bearing an `X-Machine-Id` header (or `?machineId=`
 * query param) by forwarding it to the referenced paired master with the
 * master's machineToken as Bearer auth. Existing local routes are untouched.
 *
 * Only cookie-authenticated users can proxy — a paired secondary shouldn't
 * daisy-chain through another master.
 */
export const machineProxyPlugin = new Elysia({ name: 'machine-proxy' })
  .onRequest(async ({ request }) => {
    const url = new URL(request.url);
    const machineId = pickMachineId(url, request.headers);
    if (!machineId) return;

    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }

    const target = await resolveMachine(machineId, session.user.id);
    if (!target) {
      return new Response(JSON.stringify({ error: 'Unknown or unreachable machineId' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    url.searchParams.delete(QUERY_NAME);

    try {
      // Body must be buffered: the tunnel frames it, and a relayed request may
      // be replayed onto a second hop. Streaming only worked for direct fetch.
      const body = request.method === 'GET' || request.method === 'HEAD'
        ? null
        : new Uint8Array(await request.arrayBuffer());

      const upstream = await machineFetch(target, `${url.pathname}${url.search}`, {
        method: request.method,
        headers: buildForwardHeaders(request.headers),
        body,
      });

      // Strip hop-by-hop headers on the way back too.
      // Also drop content-encoding: Bun's fetch auto-decompresses the body,
      // so forwarding the original encoding header would make the browser
      // try to decode plain bytes (ERR_CONTENT_DECODING_FAILED). content-length
      // is already in HOP_BY_HOP, which is correct since it no longer matches.
      const respHeaders = new Headers();
      upstream.headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        if (HOP_BY_HOP.has(lower)) return;
        if (lower === 'content-encoding') return;
        respHeaders.set(key, value);
      });

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: respHeaders,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `Upstream unreachable: ${(err as Error).message}` }),
        { status: 502, headers: { 'content-type': 'application/json' } },
      );
    }
  })

  // ── WebSocket reverse-proxy ─────────────────────────────────────────
  //
  // Client opens:  ws://local/ws/proxy/:machineId?path=/ws/terminal/abc
  // Plugin opens:  ws(s)://master/ws/terminal/abc
  // Messages are bridged both ways; closing either side closes the other.
  //
  // NOTE: Elysia wraps the raw Bun WebSocket in a *new* ElysiaWS instance on
  // every event callback, so properties set on `ws` in `open` are not visible
  // in `message` / `close`. Keep per-connection state in a Map keyed by
  // `ws.raw` (the underlying Bun ServerWebSocket, which IS stable).
  .ws('/ws/proxy/:machineId', {
    query: t.Object({
      path: t.String({ minLength: 1 }),
    }),
    async beforeHandle({ request, params, query, set }) {
      const userId = await resolveCallerUserId(request.headers);
      if (!userId) {
        set.status = 401;
        return 'Unauthorized';
      }
      if (!query.path.startsWith('/')) {
        set.status = 400;
        return 'path must start with /';
      }
      const target = await resolveMachine(params.machineId, userId);
      if (!target) {
        set.status = 404;
        return 'Unknown or unreachable machineId';
      }
    },
    async open(ws) {
      const { machineId } = ws.data.params;
      const { path } = ws.data.query;

      // Resolve again (cheap) — beforeHandle already validated ownership.
      const userId = await resolveCallerUserId(ws.data.request.headers);
      const target = userId ? await resolveMachine(machineId, userId) : null;
      if (!target) {
        ws.close(4401, 'Unauthorized');
        return;
      }

      const state: WsBridge = { upstream: null, buffered: [], closed: false };
      wsBridges.set(wsKey(ws), state);

      const toClient = {
        message: (data: string | Uint8Array) => {
          try { ws.send(data as string | ArrayBuffer); } catch { /* client gone */ }
        },
        close: (code: number, reason: string) => {
          state.closed = true;
          try { ws.close(code || 1000, reason); } catch { /* already closed */ }
        },
      };

      try {
        state.upstream = target.kind === 'tunnel'
          ? openTunnelUpstream(target.machineId, path, toClient)
          : openSocketUpstream(target, path, state, toClient);
      } catch (err) {
        toClient.close(1011, (err as Error).message);
        return;
      }

      // Anything the client sent while the upstream was connecting.
      for (const buf of state.buffered) state.upstream.send(buf);
      state.buffered = [];
    },
    message(ws, message) {
      const state = wsBridges.get(wsKey(ws));
      if (!state) return;
      // Elysia auto-parses JSON-looking strings into objects before this
      // callback. Re-serialize objects; pass strings/binary through.
      let payload: string | Uint8Array;
      if (typeof message === 'string') payload = message;
      else if (message instanceof ArrayBuffer) payload = new Uint8Array(message);
      else if (message instanceof Uint8Array) payload = message;
      else payload = JSON.stringify(message);

      if (state.upstream && state.ready !== false) state.upstream.send(payload);
      else state.buffered.push(payload);
    },
    close(ws) {
      const key = wsKey(ws);
      const state = wsBridges.get(key);
      wsBridges.delete(key);
      if (state && !state.closed) {
        state.closed = true;
        try { state.upstream?.close(1000, 'Client closed'); } catch { /* already closed */ }
      }
    },
  });

/** Bridge to a NAT'd secondary over its tunnel. */
function openTunnelUpstream(
  machineId: string,
  path: string,
  toClient: { message: (d: string | Uint8Array) => void; close: (c: number, r: string) => void },
): Upstream {
  const channel = machineTunnel.openWs(machineId, path, {
    onMessage: toClient.message,
    onClose: toClient.close,
  });
  return { send: (d) => channel.send(d), close: (c, r) => channel.close(c, r) };
}

/**
 * Bridge to a machine reachable by URL. For `relay`, that URL is the hub's own
 * /ws/proxy endpoint naming the final target — the hub then tunnels the last hop.
 */
function openSocketUpstream(
  target: Exclude<MachineTarget, { kind: 'tunnel' }>,
  path: string,
  state: WsBridge,
  toClient: { message: (d: string | Uint8Array) => void; close: (c: number, r: string) => void },
): Upstream {
  const base = target.url.replace(/^http/, 'ws');
  const url = target.kind === 'relay'
    ? `${base}/ws/proxy/${target.machineId}?path=${encodeURIComponent(path)}`
    : `${base}${path}`;

  const socket = new WebSocket(url, {
    headers: { authorization: `Bearer ${target.token}` },
  } as unknown as string[]);

  state.ready = false;
  socket.addEventListener('open', () => {
    state.ready = true;
    for (const buf of state.buffered) socket.send(buf);
    state.buffered = [];
  });
  socket.addEventListener('message', (event) => {
    const data = event.data;
    toClient.message(typeof data === 'string' ? data : new Uint8Array(data as ArrayBuffer));
  });
  socket.addEventListener('close', (event) => toClient.close(event.code, event.reason));
  socket.addEventListener('error', () => toClient.close(1011, 'Upstream error'));

  return {
    send: (d) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(d);
      else state.buffered.push(d);
    },
    close: (code, reason) => {
      if (socket.readyState < WebSocket.CLOSING) {
        try { socket.close(code, reason); } catch { /* already closed */ }
      }
    },
  };
}
