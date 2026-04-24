import { Elysia, t } from 'elysia';
import { auth } from '../auth';
import { pairedMastersService } from '../services/paired-masters';
import type { PairedMaster } from '../db/schema';

const HEADER_NAME = 'x-machine-id';
const QUERY_NAME = 'machineId';

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

function buildForwardHeaders(source: Headers, machineToken: string): Headers {
  const out = new Headers();
  source.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    if (lower === 'authorization') return; // replaced below
    if (lower === 'cookie') return;        // master uses its own session cookies
    if (lower === HEADER_NAME) return;     // consumed by this plugin
    out.set(key, value);
  });
  out.set('authorization', `Bearer ${machineToken}`);
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

    const master = await pairedMastersService.get(machineId, session.user.id);
    if (!master) {
      return new Response(JSON.stringify({ error: 'Unknown machineId' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    url.searchParams.delete(QUERY_NAME);
    const target = `${master.url}${url.pathname}${url.search}`;

    try {
      const upstream = await fetch(target, {
        method: request.method,
        headers: buildForwardHeaders(request.headers, master.machineToken),
        body: request.body,
        // @ts-expect-error — Bun supports duplex for streaming bodies
        duplex: 'half',
        redirect: 'manual',
      });

      // Strip hop-by-hop headers on the way back too.
      const respHeaders = new Headers();
      upstream.headers.forEach((value, key) => {
        if (!HOP_BY_HOP.has(key.toLowerCase())) respHeaders.set(key, value);
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
  .ws('/ws/proxy/:machineId', {
    query: t.Object({
      path: t.String({ minLength: 1 }),
    }),
    async beforeHandle({ request, params, query, set }) {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session) {
        set.status = 401;
        return 'Unauthorized';
      }
      const master = await pairedMastersService.get(params.machineId, session.user.id);
      if (!master) {
        set.status = 404;
        return 'Unknown machineId';
      }
      if (!query.path.startsWith('/')) {
        set.status = 400;
        return 'path must start with /';
      }
    },
    async open(ws) {
      const { machineId } = ws.data.params;
      const { path } = ws.data.query;

      // Resolve target again (cheap) — beforeHandle already validated ownership.
      const session = await auth.api.getSession({ headers: ws.data.request.headers });
      const master = session
        ? await pairedMastersService.get(machineId, session.user.id)
        : null;
      if (!master) {
        ws.close(4401, 'Unauthorized');
        return;
      }

      const upstreamUrl = toWsUrl(master, path);
      const upstream = new WebSocket(upstreamUrl);
      const state = { closed: false, buffered: [] as (string | ArrayBuffer)[] };

      // Stash upstream on the ws instance so message/close handlers can find it.
      (ws as unknown as { _upstream: WebSocket; _state: typeof state })._upstream = upstream;
      (ws as unknown as { _upstream: WebSocket; _state: typeof state })._state = state;

      upstream.addEventListener('open', () => {
        for (const buf of state.buffered) upstream.send(buf);
        state.buffered = [];
      });
      upstream.addEventListener('message', (event) => {
        if (typeof event.data === 'string') ws.send(event.data);
        else ws.send(event.data as ArrayBuffer);
      });
      upstream.addEventListener('close', (event) => {
        state.closed = true;
        try { ws.close(event.code || 1000, event.reason); } catch { /* already closed */ }
      });
      upstream.addEventListener('error', () => {
        state.closed = true;
        try { ws.close(1011, 'Upstream error'); } catch { /* already closed */ }
      });
    },
    message(ws, message) {
      const upstream = (ws as unknown as { _upstream?: WebSocket })._upstream;
      const state = (ws as unknown as { _state?: { buffered: (string | ArrayBuffer)[] } })._state;
      if (!upstream) return;
      const payload = typeof message === 'string' ? message : JSON.stringify(message);
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(payload);
      } else if (state && upstream.readyState === WebSocket.CONNECTING) {
        state.buffered.push(payload);
      }
    },
    close(ws) {
      const upstream = (ws as unknown as { _upstream?: WebSocket })._upstream;
      if (upstream && upstream.readyState < WebSocket.CLOSING) {
        try { upstream.close(); } catch { /* already closed */ }
      }
    },
  });

function toWsUrl(master: PairedMaster, path: string): string {
  const base = master.url.replace(/^http/, 'ws');
  return `${base}${path}`;
}
