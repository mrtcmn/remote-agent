# Code-Server Proxy + Remote Browser (CDP) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show VS Code (code-server) in a right panel for any session, on any machine, through the app's own port. Make the agent's browser panel (Chrome CDP) work when the session runs on a remote machine.

**Architecture:** One path-based proxy, `/code/*`, runs on every machine and forwards HTTP + WebSocket to code-server on `127.0.0.1`. The API that serves the UI forwards `/code/m/:machineId/*` to the owning machine with the existing machine transports (direct URL, tunnel, relay). For CDP, the remote machine opens a loopback CDP port that forwards, through the existing tunnel, to the Chromium panel of the desktop app that currently views the session.

**Tech Stack:** Bun, Elysia, the existing `machine-tunnel` / `machine-proxy` code, code-server, React (`packages/ui`), Electrobun CEF webview.

---

## Background the engineer must know

**The first proxy attempt failed (2026-03-07 → 2026-03-12, removed in `4bf55c4`).** Read `git show 4bf55c4^:packages/api/src/routes/editor-proxy.routes.ts` if it exists, and the messages of `c634763 48077b3 095a379 28b28cd`. The causes, and the rule each one gives us:

| Old failure | Rule in this plan |
|---|---|
| Elysia `ws.send()` JSON-encoded binary frames | Send with `ws.raw.send()`; key state by `ws.raw` (see `plugins/machine-proxy.ts:46-55`) |
| Elysia parsed JSON-looking text frames into objects | Re-serialize non-string, non-binary messages (see `machine-proxy.ts:236-241`) |
| `Sec-WebSocket-Protocol` not forwarded → handshake timeout | Forward the subprotocol both ways; Task 1 tests it |
| `fetch()` decompressed bodies, proxy sent them uncompressed → slow loads | Use Bun `fetch(url, { decompress: false })` and pass `content-encoding` through untouched |
| Proxy routes lost to the SPA catch-all | Handle HTTP in `onRequest`, before routing, like `machineProxyPlugin` |
| WS idle timeout 120 s | Set `idleTimeout: 960` on the ws route |
| `--base-path` flag does not exist | Do not pass it. code-server uses relative URLs and works under a sub-path as is |

**Transports (`services/machines/resolve.ts`).** `direct` = plain fetch to a master URL with a bearer token. `tunnel` = base64 JSON frames over one WebSocket, bodies fully buffered, 15 s timeout. `relay` = through a hub to a tunnelled peer.

**Performance, stated honestly.**
- `direct` (desktop → Docker master): one internet hop + two loopback hops. Good.
- `tunnel`: +33 % bytes (base64) and no streaming. The first load is slower; later loads use the browser cache, because code-server assets have versioned URLs. Typing is local in the browser; the WS carries file and terminal traffic.
- `relay`: two internet hops plus the tunnel cost. It works; it is the slowest path. Do not optimise it in this plan.

**CDP today (`routes/preview.routes.ts`, `mcp-server.ts:374-390`).** The agent calls `POST /preview/open` on its own machine and gets `cdpPort`. It then runs `agent-browser --cdp <port>` against `127.0.0.1:<port>`. The Chromium panel lives in the desktop app. When the session runs on a remote machine, nothing listens on that port there. That is the bug Part B fixes.

**Other sessions edit this working tree.** Stage only the files each task names. Never `git add -A`.

---

# Part A — code-server through the app port

### Task 1: Spike gate — prove WS bridging through Elysia

This failed before. Prove it in a test before any other work. If this task cannot pass, stop and report; do not continue.

**Files:**
- Create: `packages/api/src/plugins/code-proxy.ts`
- Test: `packages/api/src/plugins/code-proxy.test.ts`

**Step 1: Write the failing test**

```ts
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { codeProxy } from './code-proxy';

// Fake code-server: echoes frames, reports the subprotocol, serves a gzip body.
const upstream = Bun.serve({
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
    open(ws) { ws.send(`proto:${(ws.data as { proto: string }).proto}`); },
    message(ws, m) { ws.send(m); },
  },
});

const app = new Elysia().use(codeProxy({ port: upstream.port, authorize: async () => 'user-1' })).listen(0);
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
  const closed = new Elysia().use(codeProxy({ port: upstream.port, authorize: async () => null })).listen(0);
  expect((await fetch(`http://127.0.0.1:${closed.server!.port}/code/x`)).status).toBe(401);
  closed.stop();
});
```

**Step 2: Run it, expect failure**

Run: `cd packages/api && bun test src/plugins/code-proxy.test.ts`
Expected: FAIL, `Cannot find module './code-proxy'`.

**Step 3: Implement `code-proxy.ts`**

```ts
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
```

**Step 4: Run the test**

Run: `cd packages/api && bun test src/plugins/code-proxy.test.ts`
Expected: 4 pass.

Likely trouble and what to try, in this order:
1. Subprotocol test fails → Elysia did not echo `Sec-WebSocket-Protocol`. Add `upgrade({ request }) { const p = request.headers.get('sec-websocket-protocol'); return p ? { 'sec-websocket-protocol': p.split(',')[0].trim() } : {}; }` to the ws options.
2. `{"a":1}` comes back with different spacing → the `JSON.stringify` round-trip changed the text. Set `parse: (_ws, raw) => raw` on the ws route, if this Elysia version has it, to stop the parsing.
3. The wildcard `.ws('/code/*')` never matches → stop and report. Do not build a second listener port without asking the user.

**Step 5: Commit**

```bash
git add packages/api/src/plugins/code-proxy.ts packages/api/src/plugins/code-proxy.test.ts
git commit -m "feat(code): /code proxy to code-server, HTTP + WebSocket"
```

---

### Task 2: Mount the proxy; code-server binds to loopback only

**Files:**
- Modify: `packages/api/src/plugins/machine-proxy.ts:29-44` (export `resolveCallerUserId`)
- Modify: `packages/api/src/index.ts` (near line 90)
- Modify: `packages/api/src/services/code-server/code-server.service.ts:43`
- Modify: `packages/api/src/routes/editor.routes.ts`
- Modify: `docker/docker-compose.prod.yml:35,81-82`, `docker/docker-compose.yml`, `docker/docker-compose.dev.yml` (same lines, find with `grep -n CODE_SERVER docker/*.yml`)

**Step 1:** In `machine-proxy.ts`, add `export` to `resolveCallerUserId`. It accepts a cookie session, the local desktop owner, or a machine bearer token. The proxy needs all three.

**Step 2:** In `code-server.service.ts`, export the port constant and change the bind address:

```ts
export const CODE_SERVER_PORT = parseInt(process.env.CODE_SERVER_PORT || '8080', 10);
// ...
'--bind-addr', `127.0.0.1:${CODE_SERVER_PORT}`,
```

Reason: `--auth none` on `0.0.0.0` gave a shell to anyone who reached the port. The API is now the only door.

**Step 3:** In `index.ts`, mount the proxy directly after `.use(machineProxyPlugin)`:

```ts
.use(codeProxy({
  port: CODE_SERVER_PORT,
  authorize: resolveCallerUserId,
  onActivity: () => codeServerManager.resetIdleTimer(),
}))
```

**Step 4:** Replace `editor.routes.ts` `/status` and `/open`. Delete the `CODE_SERVER_URL` constant.

```ts
.get('/status', () => ({ status: codeServerManager.getStatus(), configured: codeServerManager.isInstalled() }))

.post('/open', async ({ body, set }) => {
  await codeServerManager.ensureRunning();
  if (codeServerManager.getStatus() !== 'running') {
    set.status = 503;
    return { error: 'Code server failed to start' };
  }
  // A path, not a URL: the caller adds its own origin and machine prefix.
  const path = body.folder ? `/code/?folder=${encodeURIComponent(body.folder)}` : '/code/';
  return { path, status: 'running' };
}, { body: t.Object({ folder: t.Optional(t.String()) }) })
```

Add to `CodeServerManager`: `isInstalled(): boolean { return !!Bun.which('code-server'); }`.

**Step 5:** In the three compose files, delete the `8080` port line and the `VITE_CODE_SERVER_URL` line. Keep `CODE_SERVER_PORT` in `environment`.

**Step 6: Verify by hand** (needs `code-server` on the machine; the Docker image has it):

```bash
curl -s -X POST localhost:<port>/api/editor/open -H 'content-type: application/json' -d '{}'   # {"path":"/code/","status":"running"}
curl -sI localhost:<port>/code/ | head -3                                                       # 200 or 302 from code-server
lsof -iTCP:8080 -sTCP:LISTEN                                                                    # bound to 127.0.0.1 only
```

Then open `http://localhost:<port>/code/` in a browser. The editor must load, and the integrated terminal must accept input (this proves the WebSocket).

**Step 7: Commit**

```bash
git add packages/api/src/plugins/machine-proxy.ts packages/api/src/index.ts packages/api/src/services/code-server/code-server.service.ts packages/api/src/routes/editor.routes.ts docker/docker-compose.prod.yml docker/docker-compose.yml docker/docker-compose.dev.yml
git commit -m "feat(code): serve code-server on the app port; bind it to loopback"
```

---

### Task 3: Tunnel carries the WebSocket subprotocol

The tunnel frame `wsopen` (`services/machine-tunnel/protocol.ts:18`) has no subprotocol field. VS Code needs it.

**Files:**
- Modify: `packages/api/src/services/machine-tunnel/protocol.ts:18`
- Modify: `packages/api/src/services/machine-tunnel/server.ts:242` (`openWs`)
- Modify: `packages/api/src/services/machine-tunnel/client.ts` (the `wsopen` handler; find with `grep -n wsopen`)
- Test: `packages/api/src/services/machine-tunnel/server.test.ts`, `client.test.ts`

**Step 1:** Add a failing test in `server.test.ts`: `openWs(id, '/x', handlers, ['vscode-test'])` sends a `wsopen` frame with `protocols: ['vscode-test']`. Follow the `fakeSocket()` pattern already in that file.

**Step 2:** Run `bun test src/services/machine-tunnel` → the new test fails.

**Step 3:** Frame becomes `{ t: 'wsopen'; id: string; path: string; protocols?: string[] }`. `openWs` takes an optional 4th argument and puts it in the frame. In `client.ts`, pass `frame.protocols` as the second argument of the `new WebSocket(...)` that the handler opens. Update `isFrame` in `protocol.ts` if it lists allowed keys.

**Step 4:** Run `bun test src/services/machine-tunnel` → all pass.

**Step 5:** Commit: `git commit -m "feat(tunnel): forward WebSocket subprotocols"` with the four files.

---

### Task 4: `/code/m/:machineId/*` — reach code-server on another machine

**Files:**
- Modify: `packages/api/src/plugins/machine-proxy.ts` (export `openTunnelUpstream`, `openSocketUpstream`, `buildForwardHeaders`; give both upstream openers a `protocols?: string[]` parameter and pass it on)
- Modify: `packages/api/src/plugins/code-proxy.ts`
- Modify: `packages/api/src/services/machines/resolve.ts:124` (`machineFetch`: accept `timeoutMs`, default unchanged)
- Test: `packages/api/src/plugins/code-proxy.test.ts`

**Step 1: Failing test.** Add an optional `resolve` option to `codeProxy`: `(machineId, userId) => Promise<MachineTarget | null>`. In the test, start a second Elysia app with `codeProxy` (this is "the remote machine") and resolve `m1` to `{ kind: 'direct', machineId: 'm1', name: 'r', url: 'http://127.0.0.1:<remote port>', token: 't' }`. Assert:
- `GET /code/m/m1/a/b?x=1` on the first app returns `path=/a/b?x=1`.
- The WS test from Task 1 passes at `ws://…/code/m/m1/ws`.
- `GET /code/m/unknown/x` returns 404.

**Step 2:** Run → fails.

**Step 3: Implement** in `code-proxy.ts`:
- HTTP, in `onRequest`, before the local branch: match `^/code/m/([^/]+)(/.*)?$`. Authorize, resolve the target, then call `machineFetch(target, '/code' + rest + search, { method, headers: buildForwardHeaders(request.headers), body, timeoutMs: 60_000 })`. Return the response with hop-by-hop headers removed. Note: `machineFetch` forces `accept-encoding: identity` for the tunnel, so those bodies arrive uncompressed. Accept this in v1.
- WS: add `.ws('/code/m/:machineId/*', …)` **before** the `/code/*` ws route. In `open`, resolve the target and call `openTunnelUpstream(target.machineId, '/code' + rest, toClient, protocols)` or `openSocketUpstream(target, '/code' + rest, state, toClient, protocols)`. Reuse the bridge code from `machine-proxy.ts`; do not copy it.
- In `index.ts`, pass `resolve: resolveMachine`.

**Step 4:** Run `bun test src/plugins` → all pass. Run the whole suite: `bun test` → nothing new fails.

**Step 5:** Commit: `git commit -m "feat(code): proxy code-server on other machines"`.

---

### Task 5: VS Code panel in the right strip

**Files:**
- Create: `packages/ui/src/components/CodePanel.tsx`
- Modify: `packages/ui/src/pages/Session.tsx` (`panelEntries` ~line 719, `moreEntries` ~line 742, panel block ~line 1041)
- Modify: `packages/ui/src/lib/api.ts:601` (`openEditor` returns `{ path: string; status: string }`)

Read `Session.tsx:1041-1080` first. The VS Code panel copies the Browser panel's shell: same width state, same drag handle, same `island` wrapper.

**Step 1:** `CodePanel.tsx`:

```tsx
import { ExternalLink, X } from 'lucide-react';

/** code-server in a side panel. `src` is same-origin: /code/... or /code/m/<machine>/... */
export function CodePanel({ src, resizing, onClose }: { src: string; resizing: boolean; onClose: () => void }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 h-8 shrink-0 text-xs text-muted-foreground">
        <span className="flex-1 truncate">VS Code</span>
        <button title="Open in a new window" onClick={() => window.open(src, '_blank')}><ExternalLink className="size-3.5" /></button>
        <button title="Close" onClick={onClose}><X className="size-3.5" /></button>
      </div>
      {/* pointer-events off while dragging, or the iframe swallows the resize. */}
      <iframe src={src} title="VS Code" className="flex-1 w-full border-0" style={{ pointerEvents: resizing ? 'none' : undefined }} allow="clipboard-read; clipboard-write" />
    </div>
  );
}
```

**Step 2:** In `Session.tsx`:
- State: `const [codeSrc, setCodeSrc] = useState<string | null>(null);`
- `openEditorMutation.onSuccess`: `setCodeSrc((ownerMachine !== 'self' ? data.path.replace(/^\/code/, `/code/m/${ownerMachine}`) : data.path))`. Check how `ownerMachine` is defined in this file and use the machine id the API calls for this session already use.
- Add to `panelEntries`, after Browser: `{ icon: <Code2 />, label: 'VS Code', active: !!codeSrc, disabled: !canOpenEditor || openEditorMutation.isPending, onSelect: () => (codeSrc ? setCodeSrc(null) : openEditorMutation.mutate(activeProject!.localPath)) }`.
- Remove the `VS Code` entry from `moreEntries`. Keep `Open in editor` there only when `canOpenLocalEditor && ownerMachine === 'self'`: a local editor cannot open a remote path.
- Render the panel next to the Browser block with the same wrapper; reuse `browserWidth` and `startBrowserResize`.
- The existing `api.editorHeartbeat` is no longer needed: every proxied request resets the idle timer. Delete the call if one exists.

**Step 3: Verify.** Run `bun run --cwd packages/ui build` → no type errors. Then check in the running app (@run skill):
1. Local session: click VS Code → the panel shows the editor with the project folder open. Type in the integrated terminal.
2. Session on a paired remote machine: same check. Watch the network tab: requests go to `/code/m/<id>/…` and return 200; the WebSocket stays open.
3. Drag the resize handle over the iframe: it must follow the pointer.

**Step 4:** Commit: `git commit -m "feat(ui): VS Code side panel"` with the three files.

---

### Task 6: Dokploy and docs

**Files:**
- Modify: `install.sh:358-370` (stop reserving/printing the code-server port as a public port)
- Modify: `README.md` (search `CODE_SERVER_URL`)

**Step 1:** Remove `CODE_SERVER_URL` from the docs and from `install.sh` output. `CODE_SERVER_PORT` stays as an internal port.

**Step 2:** Ask the user before this step — it changes a live server. On Dokploy (`compose "Remote Agent"`, id `aAPT9Z58CXWnCoC50cu4f`): no compose change is needed (it never published 8080). A redeploy after the release picks up the new image.

**Step 3:** Commit: `git commit -m "docs: code-server needs no port or URL setting"`.

---

# Part B — browser panel (CDP) for sessions on a remote machine

**Flow after this part:**

```
agent on machine M ── agent-browser --cdp P ──► 127.0.0.1:P on M   (CDP bridge, new)
                                                    │ machineTunnel.fetch / openWs
                                                    ▼
                              desktop app D: /internal/cdp/*  ──► 127.0.0.1:<CEF CDP port> on D
```

"Active viewer" = the desktop app that polls `GET /preview/open` for the session. D already polls every 1–3 s (`Session.tsx:157-163`), and the request reaches M with D's machine token, so M knows which tunnel leads back to D.

### Task 7: Track the active viewer

**Files:**
- Modify: `packages/api/src/routes/preview.routes.ts:65-74`
- Modify: `packages/ui/src/lib/api.ts` (`getOpenBrowsers` takes `viewing?: string`), `packages/ui/src/pages/Session.tsx:157` (pass the session id while the panel is open)
- Test: `packages/api/src/routes/preview.routes.test.ts` (new)

**Step 1: Failing test** for a small pure helper exported from `preview.routes.ts`:

```ts
import { expect, test } from 'bun:test';
import { viewers } from './preview.routes';

test('viewer expires after 10 s without a poll', () => {
  viewers.seen('s1', 'machine-d', 1_000);
  expect(viewers.of('s1', 5_000)).toBe('machine-d');
  expect(viewers.of('s1', 12_000)).toBeNull();
});
test('the latest poller wins', () => {
  viewers.seen('s2', 'a', 1_000);
  viewers.seen('s2', 'b', 2_000);
  expect(viewers.of('s2', 3_000)).toBe('b');
});
```

**Step 2:** Run → fails.

**Step 3:** Implement:

```ts
// ponytail: one viewer per session, last poll wins. Add a picker if two desktops fight over a session.
const VIEWER_TTL_MS = 10_000;
const seenAt = new Map<string, { machineId: string; at: number }>();
export const viewers = {
  seen(sessionId: string, machineId: string, now = Date.now()) { seenAt.set(sessionId, { machineId, at: now }); },
  of(sessionId: string, now = Date.now()): string | null {
    const v = seenAt.get(sessionId);
    return v && now - v.at < VIEWER_TTL_MS ? v.machineId : null;
  },
};
```

In `GET /open`: `if (query.viewing && session?.machineId) viewers.seen(query.viewing, session.machineId);`. Add `viewer: 'local' | 'remote' | 'none'` to each browser in the response: `local` when the API runs in local mode (the panel is on this machine), `remote` when `viewers.of(sessionId)` is set, else `none`.

**Step 4:** Run → pass. **Step 5:** Commit: `feat(browser): track which desktop views a session's browser`.

---

### Task 8: Desktop side — `/internal/cdp/*`

**Files:**
- Read first: `packages/api/src/routes/internal.routes.ts` and `packages/api/src/services/machine-tunnel/client.ts` (how a tunnelled request is authorised on the secondary). Use the same guard; do not invent a new one.
- Modify: `packages/api/src/routes/internal.routes.ts`
- Test: `packages/api/src/routes/internal-cdp.test.ts` (new)

**Step 1: Failing test.** Start a fake CDP server (`Bun.serve`) that answers `/json/version` with `{"webSocketDebuggerUrl":"ws://127.0.0.1:<its port>/devtools/browser/abc"}` and echoes on `/devtools/browser/abc`. Assert that `GET /internal/cdp/json/version` returns the same JSON, and that a WS to `/internal/cdp/devtools/browser/abc` echoes a text frame.

**Step 2:** Run → fails.

**Step 3:** Implement by reusing `codeProxy`: generalise it to `portProxy({ prefix, port, authorize })` (rename, keep `codeProxy` as a thin wrapper), and mount `portProxy({ prefix: '/internal/cdp', port: CDP_PORT, authorize: <the internal guard> })`. Local mode only: `if (isLocalMode())`.

**Step 4:** Run → pass. **Step 5:** Commit: `feat(browser): expose the desktop CDP port to paired masters`.

---

### Task 9: Remote side — loopback CDP bridge

**Files:**
- Create: `packages/api/src/services/browser-preview/cdp-bridge.ts`
- Modify: `packages/api/src/index.ts` (start it in remote mode only)
- Modify: `packages/api/src/mcp-server.ts:379-390` (error text)
- Test: `packages/api/src/services/browser-preview/cdp-bridge.test.ts`

This is a raw `Bun.serve` on `127.0.0.1:CDP_PORT`. It is a loopback port for the agent's own CLI; it is never published. `agent-browser --cdp` needs a real port, so the app port cannot serve it.

**Step 1: Failing test** with injected transports:

```ts
const bridge = startCdpBridge({
  port: 0,
  viewer: () => 'machine-d',                       // latest viewer of any session; null = none
  fetch: async (_id, path) => new Response(JSON.stringify({ webSocketDebuggerUrl: 'ws://127.0.0.1:13600/devtools/browser/abc' })),
  openWs: (_id, path, h) => ({ send: (d) => h.onMessage(d), close: () => {} }),   // echo
});
```

Assert:
- `GET /json/version` returns `webSocketDebuggerUrl` with host `127.0.0.1:<bridge port>` (rewritten).
- A WS to `/devtools/browser/abc` echoes text and binary frames.
- With `viewer: () => null`, `GET /json/version` returns 503 and the body `No desktop app is viewing a browser panel`.

**Step 2:** Run → fails.

**Step 3:** Implement. HTTP: `fetch(viewer, '/internal/cdp' + path)`, then replace every `127.0.0.1:<digits>` and `localhost:<digits>` in the JSON text with `127.0.0.1:<bridge port>`. WS: `server.upgrade`, then `openWs(viewer, '/internal/cdp' + path, …)`; Bun's raw `websocket` handlers have none of the Elysia frame problems. In `index.ts`, wire `fetch: machineTunnel.fetch.bind(machineTunnel)`, `openWs: machineTunnel.openWs.bind(machineTunnel)`, and `viewer` from Task 7.

**Step 4:** In `mcp-server.ts`, change the 15 s failure text to: `No browser panel is reachable. Ask the user to open this session in the Remote Agent desktop app and keep the Browser panel open.`

**Step 5:** Run `bun test` → pass. Commit: `feat(browser): CDP bridge from a remote machine to the viewing desktop`.

---

### Task 10: Show the status in the panel; end-to-end check

**Files:**
- Modify: `packages/ui/src/components/NativeBrowser.tsx` (header)
- Modify: `packages/ui/src/pages/Session.tsx` (pass `viewer`)

**Step 1:** In the panel header, show one small label from the `viewer` field: `Agent connected` (`local` or `remote`) or `Agent cannot reach this panel` (`none`).

**Step 2: End-to-end check** on a real remote machine, in the desktop app:
1. Open a session that runs on the remote machine. Ask the agent: "open https://example.com in the browser and take a snapshot".
2. Expected: the panel opens, the label shows `Agent connected`, the agent's `agent-browser --cdp <port> snapshot -i` returns the page tree, and the agent cursor moves in the panel.
3. Close the desktop app. Ask the agent again. Expected: the new error text from Task 9, within 15 s.

**Step 3:** Commit: `feat(browser): show if the agent can reach the panel`.

---

# Part C — direct path between machines (Tailscale address)

**Why:** `relay` (peer → hub → peer) and `tunnel` (base64 frames, buffered) are the slow paths. When two machines can reach each other directly — the same tailnet, or the same LAN — one plain HTTP hop is faster. The app does not detect networks itself. Each machine publishes one **direct address**; the others try it first and fall back.

**Decisions (from the user):**
- The address lives in the database, not only in config.
- The app detects a default. A value the user sets in the UI overrides it. Clearing the field returns to the detected value.

**Data model:**
- On each machine: `app_settings` row, key `direct_address`, value `{"url":"http://100.x.x.x:5100","source":"auto"|"user"}`. Same table the `machine-name` and `origins` settings use; no migration.
- On the hub: new nullable column `machines.direct_url`. The heartbeat fills it. Needs one migration for Postgres and one for SQLite.

**Auth for a direct call:** the caller has no token for the peer. The hub signs a short ticket with a key both the hub and the target already have: `sha256(target machineToken)`, which is `machines.token_hash` on the hub (`machine-registry/index.ts:11`). No new secret, no new table.

```
ticket = base64url(JSON{ from, owner, to, exp }) + "." + hex(HMAC-SHA256(key = tokenHash(to), payload))
```

### Task 11: Detect and store the machine's direct address

**Files:**
- Create: `packages/api/src/services/direct-address.ts`
- Test: `packages/api/src/services/direct-address.test.ts`
- Modify: `packages/api/src/index.ts` (call `directAddress.initialize()` beside `originsService.initialize()`)

**Step 1: Failing test** for the pure part:

```ts
import { expect, test } from 'bun:test';
import { detect, effective } from './direct-address';

const ifaces = (addrs: string[]) => ({ x: addrs.map((address) => ({ address, family: 'IPv4', internal: false })) }) as never;

test('picks the Tailscale address (100.64.0.0/10)', () => {
  expect(detect(ifaces(['192.168.1.5', '100.69.173.3']), 5100, {})).toBe('http://100.69.173.3:5100');
});
test('ignores 100.x outside the CGNAT range and Docker bridges', () => {
  expect(detect(ifaces(['100.128.0.1', '172.18.0.2']), 5100, {})).toBeNull();
});
test('Docker: TAILSCALE_IP seeds the value, since the container cannot see the host interface', () => {
  expect(detect(ifaces(['172.18.0.2']), 5100, { TAILSCALE_IP: '100.69.173.3', PORT: '5100' })).toBe('http://100.69.173.3:5100');
});
test('a user value wins; clearing it returns to auto', () => {
  expect(effective({ url: 'http://10.0.0.9:5100', source: 'user' }, 'http://100.1.1.1:5100')).toBe('http://10.0.0.9:5100');
  expect(effective(null, 'http://100.1.1.1:5100')).toBe('http://100.1.1.1:5100');
});
```

**Step 2:** Run `bun test src/services/direct-address.test.ts` → fails.

**Step 3:** Implement:
- `detect(interfaces, port, env)`: first non-internal IPv4 whose first octet is 100 and second octet is 64–127; else `env.TAILSCALE_IP`; else `null`. The env var is a seed for detection only — the stored value is what the app uses.
- `effective(stored, detected)`: `stored?.source === 'user' ? stored.url : detected`.
- `class DirectAddress`: `initialize()` reads the row, runs `detect(os.networkInterfaces(), getDefaultPort(), process.env)`, and writes `{url, source:'auto'}` when the row is missing or its source is `auto` and the value changed. `get(): string | null`. `set(url: string | null)`: a URL writes `source:'user'`; `null` deletes the row and re-runs detection. Validate with `new URL()` and require `http:` or `https:`. Copy the read/write pattern from `services/origins.ts`.
- Re-run detection every 5 minutes (`setInterval`, `unref()`): a laptop's Tailscale address appears after boot.

**Step 4:** Run → pass. **Step 5:** Commit: `feat(machines): detect and store this machine's direct address`.

### Task 12: Settings API + UI override

**Files:**
- Modify: `packages/api/src/routes/settings.routes.ts` (beside `/machine-name`, line 85)
- Modify: `packages/ui/src/lib/api.ts`, `packages/ui/src/components/MachinesSection.tsx`

**Step 1:** Routes:

```ts
.get('/direct-address', () => directAddress.describe())   // { url, source, detected }
.put('/direct-address', async ({ body, set }) => {
  try { await directAddress.set(body.url?.trim() || null); } catch (e) { set.status = 400; return { error: (e as Error).message }; }
  return directAddress.describe();
}, { body: t.Object({ url: t.Optional(t.Nullable(t.String())) }) })
```

**Step 2:** UI, in `MachinesSection.tsx` under the machine-name field: one text input "Direct address", placeholder = the detected value, helper text "Other machines try this address first. Leave empty to detect it." Show a small `auto` / `set by you` label from `source`. Save on blur; an empty value sends `null`. `/settings/*` already follows the active machine (`lib/active-machine.ts`), so the same field edits a remote machine when one is selected — check that `/settings` is not in `LOCAL_ONLY_PREFIXES`.

**Step 3:** Verify in the app: the field shows the detected address; set a value → reload → it stays and the label says `set by you`; clear it → the detected value returns.

**Step 4:** Commit: `feat(ui): direct address setting with auto-detect`.

### Task 13: Hub stores and shares the address

**Files:**
- Modify: `packages/api/src/db/schema.pg.ts`, `schema.sqlite.ts` (`machines`: add `directUrl: text('direct_url')`)
- Generate: `cd packages/api && bun run db:generate && bun run db:generate:sqlite` (commit the new files in `drizzle/` and `drizzle-sqlite/`)
- Modify: `services/master-sync/index.ts` (heartbeat body + `PeerSummary`), `routes/machines.routes.ts:31-48,50-66`, `services/machine-registry/index.ts` (`recordHeartbeat`), `services/machine-tunnel/protocol.ts:26` (the tunnel `heartbeat` frame, if the registry is fed from it)

**Step 1:** Add `directUrl: t.Optional(t.Nullable(t.String()))` to the heartbeat body; `recordHeartbeat` writes it. `GET /machines` and `GET /machines/me/peers` return it. `PeerSummary` gets `directUrl: string | null`. The heartbeat sends `directAddress.get()`.

**Step 2:** Add a case to the existing registry/route tests: a heartbeat with `directUrl` makes `listForUser` return it. Run `bun test` → pass.

**Step 3:** Commit: `feat(machines): hub stores each machine's direct address`.

### Task 14: Tickets

**Files:**
- Create: `packages/api/src/services/machines/ticket.ts`
- Test: `packages/api/src/services/machines/ticket.test.ts`
- Modify: `routes/machines.routes.ts` (issue), `auth/middleware.ts` (accept)

**Step 1: Failing test:**

```ts
import { expect, test } from 'bun:test';
import { signTicket, verifyTicket } from './ticket';

const key = 'a'.repeat(64);
test('round trip', () => {
  const t = signTicket({ from: 'A', owner: 'u1', to: 'B', exp: 2_000 }, key);
  expect(verifyTicket(t, key, 'B', 1_000)).toEqual({ from: 'A', owner: 'u1', to: 'B', exp: 2_000 });
});
test('rejects: expired, wrong target, wrong key, edited payload', () => {
  const t = signTicket({ from: 'A', owner: 'u1', to: 'B', exp: 2_000 }, key);
  expect(verifyTicket(t, key, 'B', 3_000)).toBeNull();
  expect(verifyTicket(t, key, 'C', 1_000)).toBeNull();
  expect(verifyTicket(t, 'b'.repeat(64), 'B', 1_000)).toBeNull();
  expect(verifyTicket('x' + t, key, 'B', 1_000)).toBeNull();
});
```

**Step 2:** Run → fails. **Step 3:** Implement with `Bun.CryptoHasher('sha256', key)` for the HMAC and `crypto.timingSafeEqual` for the compare.

**Step 4:** Hub route, machine-token callers only: `POST /machines/:id/ticket` → checks the same-owner rule (reuse `decideRelay`'s owner check) → `{ ticket, exp }` with a 10-minute life.

**Step 5:** Target side, in `auth/middleware.ts`: accept `Authorization: Ticket <ticket>`. The key is `sha256(own machineToken)` for each paired master (`pairedMasters.machineToken`); `to` must equal this machine's id at that master. A valid ticket authenticates as that master's owner user. Read how the bearer branch resolves the user and follow it exactly.

**Step 6:** Run `bun test` → pass. Commit: `feat(machines): hub-signed tickets for direct peer calls`.

### Task 15: Resolver tries the direct address first

**Files:**
- Modify: `packages/api/src/services/machines/resolve.ts`
- Test: `packages/api/src/services/machines/resolve-direct.test.ts`

**Step 1: Failing tests** for a small cache class with an injected probe:

- A reachable `directUrl` turns a `relay` target into `{ kind: 'direct', url: directUrl, token: <ticket>, auth: 'ticket' }`.
- An unreachable one (probe rejects) keeps `relay`, and the probe is not repeated for 60 s.
- A failed direct request clears the cache entry, so the next call uses `relay` again.

**Step 2:** Run → fails.

**Step 3:** Implement:
- Probe: `GET <directUrl>/health`, 500 ms timeout, then one ticketed `GET /api/machines/whoami` that must return the expected machine id. This check stops a different device at the same address from receiving traffic.
- Cache per machine id: `{ ok, until }`, 60 s. Cache the ticket until 1 minute before `exp`.
- `resolveMachine` step 3 (`relay`) and `listTargets`: when the peer has a `directUrl` and the cache says `ok`, return the direct target. `machineFetch` and `openSocketUpstream` send `Authorization: Ticket …` when `auth === 'ticket'`.
- Hub → secondary (`tunnel` kind): same upgrade; the hub signs the ticket itself, no HTTP call.
- On a network error from a direct target, clear the cache and retry once through the original transport.

**Step 4:** Run `bun test` → pass.

**Step 5: Verify on two real machines in one tailnet**, both paired to the same hub: open a session on the peer and watch the API log — requests go to `http://100.x…`, not to the hub. Run `tailscale down` on the peer: within 60 s requests go through the hub again and the session stays usable.

**Step 6:** Commit: `feat(machines): use a peer's direct address before the relay`.

### Task 16: Installer writes the seed

**Files:** Modify `install.sh` (the `.env` block near line 298), `docker/docker-compose.prod.yml` (pass `TAILSCALE_IP=${TAILSCALE_IP:-}`)

**Step 1:** In `install.sh`: `TS_IP="$(command -v tailscale >/dev/null && tailscale ip -4 2>/dev/null | head -1 || true)"`. When set, write `TAILSCALE_IP=$TS_IP` to `.env`. If `BIND_HOST` is `127.0.0.1`, print a warning: the direct address needs the app port on the Tailscale address; offer `BIND_HOST=$TS_IP`. Do not change `BIND_HOST` without the user's answer.

**Step 2:** `bash -n install.sh` → no output. Commit: `feat(install): seed the direct address from Tailscale`.

---

## Known limits (do not fix in this plan)

- **Direct calls use plain `http`.** Tailscale encrypts them. On a plain LAN address that a user typed in, the ticket protects access but the content is not encrypted. The UI helper text must say this.

- **`localhost` URLs in the remote browser panel.** The Chromium panel runs on the desktop. `http://localhost:3000` from an agent on a remote machine loads the desktop's port 3000, not the remote one. A generic port proxy can fix this later, but apps with absolute paths break under a sub-path.
- **Insecure context.** Through a plain `http` master URL, the page is not a secure context. VS Code webviews (Markdown preview) and some clipboard actions need one. Through the desktop app the page origin is `localhost`, which is secure, so the panel is better than the old new-tab flow.
- **Tunnel and relay speed.** See "Performance" above. If it is too slow in use, the next step is binary tunnel frames, not a new port.
- **One viewer per session.** Last poll wins.

## Order and releases

The three parts are independent. Ship Part A first (Tasks 1-6), release, then Part B (Tasks 7-10), then Part C (Tasks 11-16). Part C makes Part A faster for peers, but Part A works without it. Each part needs a version bump in the root `package.json` and the `release` skill.
