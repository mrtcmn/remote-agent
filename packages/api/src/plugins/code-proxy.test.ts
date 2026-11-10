import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { codeProxy } from './code-proxy';

// Fake code-server: echoes frames, reports the subprotocol, serves a gzip body.
const upstream = Bun.serve<{ proto: string }>({
  port: 0,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      const proto = req.headers.get('sec-websocket-protocol') ?? '';
      return server.upgrade(req, { headers: proto ? { 'sec-websocket-protocol': proto } : {}, data: { proto } })
        ? undefined : new Response('no', { status: 400 });
    }
    if (url.pathname === '/gz') {
      return new Response(Bun.gzipSync('hello '.repeat(1000)), {
        headers: { 'content-encoding': 'gzip', 'content-type': 'text/plain' },
      });
    }
    return new Response(`path=${url.pathname}${url.search}`);
  },
  websocket: {
    open(ws) { ws.send(`proto:${ws.data.proto}`); },
    message(ws, m) { ws.send(m); },
  },
});

const app = new Elysia().use(codeProxy({ port: upstream.port!, authorize: async () => 'user-1' })).listen(0);
const base = `127.0.0.1:${app.server!.port}`;
afterAll(() => { app.stop(); upstream.stop(true); });

test('HTTP: strips /code, keeps the query', async () => {
  expect(await (await fetch(`http://${base}/code/a/b?x=1`)).text()).toBe('path=/a/b?x=1');
});

test('HTTP: gzip passes through still compressed', async () => {
  const res = await fetch(`http://${base}/code/gz`, { decompress: false } as RequestInit);
  expect(res.headers.get('content-encoding')).toBe('gzip');
  expect(Bun.gunzipSync(new Uint8Array(await res.arrayBuffer())).length).toBe(6000);
});

test('WS: subprotocol, text that looks like JSON, and binary all survive', async () => {
  const ws = new WebSocket(`ws://${base}/code/ws`, ['vscode-test']);
  ws.binaryType = 'arraybuffer';
  const got: (string | Uint8Array)[] = [];
  const done = new Promise<void>((resolve) => {
    ws.onmessage = (e) => {
      got.push(typeof e.data === 'string' ? e.data : new Uint8Array(e.data));
      if (got.length === 3) resolve();
    };
  });
  await new Promise((r) => (ws.onopen = r));
  ws.send('{"a":1}');
  ws.send(new Uint8Array([0, 255, 10, 13]));
  await done;
  expect(ws.protocol).toBe('vscode-test');
  expect(got[0]).toBe('proto:vscode-test');
  expect(got[1]).toBe('{"a":1}');
  expect(got[2]).toEqual(new Uint8Array([0, 255, 10, 13]));
  ws.close();
});

test('401 without a user', async () => {
  const closed = new Elysia().use(codeProxy({ port: upstream.port!, authorize: async () => null })).listen(0);
  expect((await fetch(`http://127.0.0.1:${closed.server!.port}/code/x`)).status).toBe(401);
  closed.stop();
});
