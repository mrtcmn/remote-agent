import { afterAll, expect, test } from 'bun:test';
import { startCdpBridge } from './cdp-bridge';

let viewer: string | null = 'machine-d';
const asked: string[] = [];
const bridge = startCdpBridge<string>({
  port: 0,
  viewer: () => viewer,
  fetch: async (_v, path) => {
    asked.push(path);
    return new Response(JSON.stringify({ webSocketDebuggerUrl: 'ws://127.0.0.1:13600/devtools/browser/abc' }));
  },
  openWs: (_v, path, h) => { asked.push(path); return { send: (d) => h.message(d), close: () => {} }; }, // echo
});
afterAll(() => bridge.stop(true));

test('/json/version points the agent back at the bridge', async () => {
  const body = await fetch(`http://127.0.0.1:${bridge.port}/json/version`).then((r) => r.json()) as { webSocketDebuggerUrl: string };
  expect(body.webSocketDebuggerUrl).toBe(`ws://127.0.0.1:${bridge.port}/devtools/browser/abc`);
  expect(asked).toContain('/panel-cdp/json/version');
});

test('a WebSocket carries text and binary frames both ways', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/devtools/browser/abc`);
  ws.binaryType = 'arraybuffer';
  const got: unknown[] = [];
  const done = new Promise<void>((resolve) => { ws.onmessage = (e) => { got.push(e.data); if (got.length === 2) resolve(); }; });
  await new Promise((r) => (ws.onopen = r));
  ws.send('{"id":1,"method":"Browser.getVersion"}');
  ws.send(new Uint8Array([1, 2, 3]));
  await done;
  expect(got[0]).toBe('{"id":1,"method":"Browser.getVersion"}');
  expect(new Uint8Array(got[1] as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
  expect(asked).toContain('/panel-cdp/devtools/browser/abc');
  ws.close();
});

test('no viewer: 503 with a text the agent can act on', async () => {
  viewer = null;
  const res = await fetch(`http://127.0.0.1:${bridge.port}/json/version`);
  expect(res.status).toBe(503);
  expect(await res.text()).toBe('No desktop app is viewing a browser panel');
});
