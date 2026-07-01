# Electron → Electrobun Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Electron desktop shell with an Electrobun (Bun-runtime) shell that reaches feature parity with today's app — frameless window, tray, folder picker, window-bounds persistence, external-link routing, settings store, and the local Bun/Elysia API server — at a fraction of the bundle size, while keeping crash isolation for the API server.

**Architecture:** A new `packages/desktop` package (Electrobun) is built **alongside** the existing `packages/electron` so both can ship until parity is proven. The Electrobun main process (a vendored Bun runtime) creates the window, tray, and a typed RPC bridge, and spawns the API server as a **separate child process run by Electrobun's own vendored Bun** (`Bun.spawn([vendoredBun, server.js])`) — one Bun runtime total, full crash isolation, smallest bundle. The React UI (`packages/ui`, unchanged and framework-agnostic) is mounted by a thin desktop renderer that installs a `window.electronAPI` shim over Electrobun RPC, so the UI's existing `electronAPI` contract keeps working with zero UI source changes to its detection logic.

**Tech Stack:** Electrobun `@beta` (v1.18.x), Bun, Elysia (API, unchanged), React + Vite + Tailwind (UI, unchanged), TypeScript. Electrobun imports: `electrobun/bun` (main process: `BrowserWindow`, `Tray`, `Utils`, `PATHS`, `BrowserView`, default `Electrobun`), `electrobun/view` (renderer: `Electroview`), `electrobun` (shared `RPCSchema` type).

---

## Locked Decisions (do not relitigate)

1. **API server execution = "Reuse vendored Bun".** Bundle the server as runnable JS (`bun build --target=bun`, NOT `--compile`), ship it via `build.copy`, and run it with Electrobun's bundled Bun at `Contents/MacOS/bun` via `Bun.spawn`. Keeps crash isolation; avoids shipping a second Bun runtime. `bun:sqlite` is provided by the vendored Bun.
2. **Layout = coexist.** New `packages/desktop`; `packages/electron` stays until cutover (Phase 7).
3. The React UI in `packages/ui` stays framework-agnostic. The Electrobun integration (Electroview + `window.electronAPI` shim + React mount) lives entirely in `packages/desktop`.

---

## Verified Electrobun API Cheat-Sheet (v1.18.x-beta)

This was adversarially fact-checked against official docs + GitHub source. Trust this over memory; the framework is young and several plausible-looking APIs do **not** exist.

**Imports**
- Main process: `import Electrobun, { BrowserWindow, BrowserView, Tray, Utils, PATHS } from "electrobun/bun"`
- Renderer: `import Electrobun, { Electroview } from "electrobun/view"`
- Shared type: `import type { RPCSchema } from "electrobun"`

**Window** — `new BrowserWindow(opts)`:
- Geometry is nested: `frame: { x, y, width, height }` (defaults 0/0/800/600). **No** top-level `width/height`. **No** `minWidth/minHeight` (see Risk R1).
- `titleBarStyle: "hiddenInset"` = the Electron `hiddenInset` equivalent (overlaid macOS traffic lights; behaves like `"hidden"` on Win/Linux). Optional `trafficLightOffset: {x,y}`.
- **No `backgroundColor` option** — use CSS `body{background:#0a0a0a}` (and/or `transparent: true`).
- Content: `url:` accepts `https://…`, `http://localhost:…`, or bundled `views://mainview/index.html`. Or `html: "<…>"`. After create: `win.webview.loadURL(url)`.
- Bounds: `win.on("resize", e => e.data /* {id,x,y,width,height} */)`, `win.on("move", e => e.data /* {id,x,y} */)`. Read: `win.getFrame() // {x,y,width,height}`. Set on create via `frame`.
- Show/hide: `win.show()` (show+activate), `win.hide()`, `win.activate()` (focus). `win.focus()` is **deprecated** → use `activate()`.

**External links / navigation** (no `setWindowOpenHandler`):
- `Utils.openExternal(url)` = `shell.openExternal`. (`Utils.openPath`, `Utils.showItemInFolder` also exist.)
- New-window/popup: `win.webview.on("new-window-open" as any, (e) => { const url = typeof e.detail === "object" ? e.detail.url : e.detail; Utils.openExternal(url); })` — **note `e.detail`** (not `e.data`); **the event name is NOT in the TS union, cast `as any`.**
- Declarative blocking: `win.webview.setNavigationRules(["^https://other.example/*", "views://*", "https://ra.grasco.dev/*"])` — `^` prefix = block, else allow, last match wins, no match = allowed.
- Observe (not block): `win.webview.on("will-navigate", e => e.data /* {url, allowed} */)`.

**Lifecycle** (no `app.whenReady` — top-level code runs at boot):
- `Electrobun.events.on("before-quit", async (e) => {…})` — async, cancelable via `e.response = { allow: false }`. Fires for all quit paths.
- `Electrobun.events.on("reopen", () => {…})` = macOS dock-click / `activate`.
- **No `window-all-closed` event** → config flag `runtime.exitOnLastWindowClosed` (default `true`; set `false` for tray-survives-window-close).
- Graceful quit: `Utils.quit()`. `process.exit` is monkey-patched → `quitGracefully(timeoutMs: 5000)`.

**Tray** — `new Tray({ title?, image?, template?, width?, height? })`:
- `image`: `views://assets/trayTemplate.png` or absolute path. `template: true` (default) = macOS monochrome template image. `width/height` default 16.
- `tray.setMenu([{ type: "normal", label, action }, { type: "divider" }, …])`.
- `tray.on("tray-clicked", (e) => { switch (e.data.action) {…} })`. **Bare icon click → `action === ""`.** Other methods: `setTitle`, `setImage`, `setVisible`, `getBounds`, `remove`.

**Native folder picker** — `await Utils.openFileDialog(opts): Promise<string[]>`:
- Options: `{ startingFolder?, allowedFileTypes?, canChooseFiles?, canChooseDirectory?, allowsMultipleSelection? }`. Electron `['openDirectory','createDirectory']` → `{ canChooseFiles: false, canChooseDirectory: true }`. **No `createDirectory` option** (the native New Folder button is always present).
- **CANCEL GOTCHA:** returns `[""]` (one-element array with an empty string), **not** `[]`. Guard: `if (!paths.length || paths[0] === "") { /* canceled */ }`.

**RPC** (replaces preload + contextBridge + ipcMain/ipcRenderer):
- Shared schema type: `{ bun: RPCSchema<{ requests; messages }>, webview: RPCSchema<{ requests; messages }> }`. `requests` = call+await (`params`/`response`); `messages` = one-way.
- Main: `const rpc = BrowserView.defineRPC<Schema>({ maxRequestTime: 15000, handlers: { requests: {…}, messages: {…} } })`; pass `rpc` to `new BrowserWindow({ …, rpc })`. Main→renderer: `win.webview.rpc.request.someFn(...)`.
- Renderer: `const rpc = Electroview.defineRPC<Schema>({ handlers: {…} }); const ev = new Electroview({ rpc }); await ev.rpc.request.getApiUrl();`
- **`window.electrobun.rpc` is NOT a guaranteed production global** (test-harness only). We install our own `window.electronAPI` shim instead.

**Sidecar / child process** (Electrobun has **no** spawn API):
- Use `Bun.spawn(cmd, { env, cwd, stdout, stderr })` directly. Vendored Bun at `join(PATHS.RESOURCES_FOLDER, "..", "MacOS", "bun")`. Copied files land at `Contents/Resources/app/<dest>`; reference via `join(PATHS.RESOURCES_FOLDER, "app", <dest>)`. Runtime `cwd` is `Contents/MacOS`.
- **You must kill the child yourself**: `Electrobun.events.on("before-quit", () => proc.kill())` + `process.on("exit", () => proc.kill())`. Electrobun does not track grandchildren.
- **launchd PATH problem still applies** — keep the login-shell PATH resolution and inject it via the spawn `env`.

**Persistence** (no electron-store):
- `Utils.paths.userData` = `{appData}/{identifier}/{channel}` (per-channel!). Write your own JSON: `mkdirSync(Utils.paths.userData, {recursive:true})` + `writeFileSync(join(userData,"settings.json"), …)`. **Never write into `PATHS.RESOURCES_FOLDER`** (breaks code-signing integrity).

**Config** `electrobun.config.ts` (`export default { … } satisfies ElectrobunConfig`):
- `app: { name, identifier, version }`; `build: { bun: { entrypoint }, views: { <name>: { entrypoint } }, copy: { src: dest }, mac: { bundleCEF, defaultRenderer, codesign, notarize }, win: {…}, linux: { bundleCEF: true, defaultRenderer: "cef" } }`; `runtime: { exitOnLastWindowClosed }`; `scripts: { preBuild, postBuild, postWrap, postPackage }`; `release: { baseUrl }`. **`views`/`copy` nest under `build`** (a root-level `views` key is wrong).
- CLI: `electrobun init [template]`, `electrobun dev [--watch]`, `electrobun build [--env=dev|canary|stable]` (default `dev`), `electrobun run`.

**Build artifacts / sizes:** macOS `.dmg` + `.app.tar.zst` + `update.json` + `.patch`; Windows `-Setup.zip` (.exe); Linux `Setup.tar.gz` (no AppImage/.deb). ~14–16 MB system-webview; ~100 MB if `bundleCEF`. macOS signing via `build.mac.codesign/notarize` + `ELECTROBUN_*` env vars. Auto-update via built-in `Updater` (`Electrobun.Updater.getLocal` getter — **not** `getLocalInfo()` — plus `checkForUpdate()`, `updateInfo()`, `downloadUpdate()`, `applyUpdate()`) + `release.baseUrl`.

---

## Parity Inventory (Electron → Electrobun)

| Capability | Electron (today) | Electrobun target | Task |
|---|---|---|---|
| Window create + frameless inset titlebar | `BrowserWindow` `frame:false`, `titleBarStyle:'hiddenInset'` | `BrowserWindow` `frame:{}`, `titleBarStyle:"hiddenInset"` | T10 |
| Min window size 800×600 | `minWidth/minHeight` | ❌ unsupported — Risk R1 | T10 |
| Background `#0a0a0a` | `backgroundColor` | CSS `body{background:#0a0a0a}` | T10, T16 |
| Content: dev URL / local file / remote URL | `loadURL`/`loadFile` | `url:` (`http://localhost`, `views://`, `https://`) | T10, T18 |
| External links → default browser | `setWindowOpenHandler`+`will-navigate`+`shell.openExternal` | `new-window-open`+`setNavigationRules`+`Utils.openExternal` | T11 |
| Window bounds persistence | `electron-store` + resize/move | settings JSON + `win.on("resize"/"move")` | T5, T12 |
| Tray + menu | `Tray`+`Menu.buildFromTemplate`+`nativeImage` | `Tray`+`setMenu`+`tray-clicked` | T13 |
| App lifecycle | `whenReady`/`window-all-closed`/`activate`/`before-quit` | top-level + `events.on("before-quit"/"reopen")` + `exitOnLastWindowClosed` | T14 |
| IPC bridge (5 methods) | preload `contextBridge` + `ipcMain.handle` | Electroview RPC + `window.electronAPI` shim | T4, T15, T16 |
| Folder picker | `dialog.showOpenDialog` | `Utils.openFileDialog` (cancel = `[""]`) | T15 |
| Health check fetch | `net.fetch` | `fetch` (Bun built-in) | T8 |
| Settings store | `electron-store` (schema) | JSON in `Utils.paths.userData` | T5 |
| Spawn API server | `child_process.spawn` compiled `dist/server` | `Bun.spawn([vendoredBun, server.js])` | T6, T9 |
| Login-shell PATH fix | `execSync($SHELL -ilc …)` | same, via `Bun.spawn` (still required) | T7, T9 |
| Package/dist | `electron-builder` (dmg/nsis/AppImage) | `electrobun build` (dmg/Setup.zip/Setup.tar.gz) | T20, T22 |

---

# Phase 0 — Scaffolding

### Task 1: Create the `packages/desktop` package skeleton

**Files:**
- Create: `packages/desktop/package.json`
- Create: `packages/desktop/tsconfig.json`
- Create: `packages/desktop/.gitignore`

**Step 1: Write `packages/desktop/package.json`**

```json
{
  "name": "@remote-agent/desktop",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "concurrently -k \"bun run dev:ui\" \"electrobun dev\"",
    "dev:ui": "vite",
    "build:ui": "vite build",
    "build:server": "bun run --cwd ../api ui-manifest && bun build ../api/src/index.ts --target=bun --outfile dist-server/index.js --external playwright --external playwright-core",
    "build": "bun run build:ui && bun run build:server && electrobun build",
    "build:stable": "bun run build:ui && bun run build:server && electrobun build --env=stable"
  },
  "dependencies": {
    "@remote-agent/ui": "workspace:*"
  },
  "devDependencies": {
    "electrobun": "beta",
    "concurrently": "^9.0.0",
    "vite": "^6.0.0",
    "typescript": "^5.4.0"
  }
}
```

**Step 2: Write `packages/desktop/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "types": ["bun-types"],
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["src", "electrobun.config.ts", "vite.config.ts"]
}
```

**Step 3: Write `packages/desktop/.gitignore`**

```
dist/
dist-server/
build/
artifacts/
```

**Step 4: Install deps and verify Electrobun resolves**

Run: `cd packages/desktop && bun install`
Then: `bun pm ls | grep electrobun`
Expected: a line showing `electrobun@1.18.x` (a `1.18.*-beta.*` version is expected — it is published under the `beta` tag).

**Step 5: Commit**

```bash
git add packages/desktop/package.json packages/desktop/tsconfig.json packages/desktop/.gitignore
git commit -m "chore(desktop): scaffold Electrobun package alongside Electron"
```

---

### Task 2: Write `electrobun.config.ts`

**Files:**
- Create: `packages/desktop/electrobun.config.ts`

**Step 1: Write the config**

```typescript
import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Remote Agent",
    identifier: "com.remote-agent.app",
    version: "1.0.0",
  },
  build: {
    bun: {
      // Main process entrypoint (the Bun side).
      entrypoint: "src/bun/index.ts",
    },
    views: {
      // The renderer view. In production this is served from views://mainview/.
      mainview: { entrypoint: "src/mainview/index.tsx" },
    },
    copy: {
      // Vite-built UI -> bundled view assets (views://mainview/...).
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
      // The API server bundle (runnable JS, run by the vendored Bun).
      "dist-server/index.js": "server/index.js",
      // Drizzle migration files the server needs at runtime.
      "../api/drizzle": "server/drizzle",
      "../api/drizzle-sqlite": "server/drizzle-sqlite",
      // Tray icon.
      "assets/trayTemplate.png": "views/assets/trayTemplate.png",
      "assets/trayTemplate@2x.png": "views/assets/trayTemplate@2x.png",
    },
    mac: {
      bundleCEF: false,
      defaultRenderer: "native",
      // codesign: true, notarize: true,  // enable in Task 22
    },
    win: { bundleCEF: false, defaultRenderer: "native" },
    // Linux: GTK/WebKitGTK can't do Electrobun's webview layering — bundle CEF.
    linux: { bundleCEF: true, defaultRenderer: "cef" },
  },
  runtime: {
    // Tray keeps the app alive after the window closes (current macOS behavior).
    exitOnLastWindowClosed: false,
  },
  // release: { baseUrl: "https://updates.example.com/remote-agent" }, // Task 22
} satisfies ElectrobunConfig;
```

**Step 2: Copy the tray icons into the package**

Run: `cp packages/electron/assets/trayTemplate*.png packages/desktop/assets/ 2>/dev/null; ls packages/desktop/assets/`
Expected: `trayTemplate.png` and `trayTemplate@2x.png` listed. (Run `mkdir -p packages/desktop/assets` first if needed.)

**Step 3: Commit**

```bash
git add packages/desktop/electrobun.config.ts packages/desktop/assets/
git commit -m "feat(desktop): add electrobun.config.ts and tray assets"
```

> **Note:** the `copy` destinations under `views/` map to the `views://` URL space; `server/` is a plain folder under `Contents/Resources/app/`. Verify the real `build.copy` directory semantics on first `electrobun build` (Risk R5) and adjust `dist-server` source path if Vite/Electrobun output dirs differ.

---

# Phase 1 — Shared RPC contract

### Task 3: Define the RPC schema (the bridge contract)

**Files:**
- Create: `packages/desktop/src/shared/rpc.ts`

**Step 1: Write the shared schema**

```typescript
import type { RPCSchema } from "electrobun";

// Mirrors the existing window.electronAPI contract (preload.ts) so the UI is unchanged.
export type DesktopRPC = {
  bun: RPCSchema<{
    requests: {
      getApiUrl: { params: Record<string, never>; response: string };
      setApiUrl: { params: { url: string }; response: void };
      getMode: { params: Record<string, never>; response: "local" | "remote" };
      setMode: { params: { mode: "local" | "remote" }; response: void };
      checkConnection: {
        params: { url: string };
        response: { ok: boolean; mode?: string; error?: string };
      };
      selectFolder: {
        params: { title?: string; defaultPath?: string };
        response: { canceled: boolean; path: string | null };
      };
    };
    messages: Record<string, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: Record<string, never>;
  }>;
};
```

**Step 2: Typecheck**

Run: `cd packages/desktop && bunx tsc --noEmit`
Expected: no errors (or only "Cannot find module" for files not yet created — none referenced here).

**Step 3: Commit**

```bash
git add packages/desktop/src/shared/rpc.ts
git commit -m "feat(desktop): define typed RPC schema mirroring electronAPI"
```

---

# Phase 2 — Settings store (replace electron-store)

### Task 4: Settings store — failing test

**Files:**
- Create: `packages/desktop/src/bun/store.ts`
- Test: `packages/desktop/src/bun/store.test.ts`

**Step 1: Write the failing test** (`store.test.ts`)

```typescript
import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "./store";

test("returns schema defaults when no file exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "ra-store-"));
  const store = createStore(dir);
  expect(store.get("mode")).toBe("local");
  expect(store.get("apiUrl")).toBe("");
  expect(store.get("windowBounds")).toEqual({ width: 1200, height: 800 });
});

test("persists and reloads values across instances", () => {
  const dir = mkdtempSync(join(tmpdir(), "ra-store-"));
  const a = createStore(dir);
  a.set("apiUrl", "http://localhost:13590");
  a.set("windowBounds", { x: 10, y: 20, width: 900, height: 700 });
  const b = createStore(dir);
  expect(b.get("apiUrl")).toBe("http://localhost:13590");
  expect(b.get("windowBounds")).toEqual({ x: 10, y: 20, width: 900, height: 700 });
});
```

**Step 2: Run it; verify it fails**

Run: `cd packages/desktop && bun test src/bun/store.test.ts`
Expected: FAIL — `Cannot find module "./store"` / `createStore is not a function`.

**Step 3: Implement `store.ts`**

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface StoreSchema {
  mode: "local" | "remote";
  apiUrl: string;
  windowBounds: { x?: number; y?: number; width: number; height: number };
}

const DEFAULTS: StoreSchema = {
  mode: "local",
  apiUrl: "",
  windowBounds: { width: 1200, height: 800 },
};

export interface Store {
  get<K extends keyof StoreSchema>(key: K): StoreSchema[K];
  set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void;
}

/**
 * JSON-file-backed settings store (electron-store replacement).
 * `dir` is Utils.paths.userData in production; a temp dir in tests.
 */
export function createStore(dir: string): Store {
  const file = join(dir, "settings.json");
  let data: StoreSchema = { ...DEFAULTS };

  if (existsSync(file)) {
    try {
      data = { ...DEFAULTS, ...JSON.parse(readFileSync(file, "utf-8")) };
    } catch {
      // Corrupt file -> fall back to defaults (matches electron-store leniency).
    }
  }

  const persist = () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2));
  };

  return {
    get: (key) => data[key],
    set: (key, value) => {
      data[key] = value;
      persist();
    },
  };
}
```

**Step 4: Run the test; verify it passes**

Run: `cd packages/desktop && bun test src/bun/store.test.ts`
Expected: PASS (2 tests).

**Step 5: Commit**

```bash
git add packages/desktop/src/bun/store.ts packages/desktop/src/bun/store.test.ts
git commit -m "feat(desktop): JSON settings store with tests"
```

---

# Phase 3 — API server runner (replace local-api.ts)

### Task 5: Build the API server as runnable JS

**Files:**
- Modify: `packages/api/package.json` (add a `build:lib` script — do **not** change the existing `build`)

**Step 1: Add the script** (`packages/api/package.json`, in `scripts`)

```json
"build:lib": "bun run scripts/generate-ui-manifest.ts && bun build src/index.ts --target=bun --outfile dist/server.js --external playwright --external playwright-core"
```

**Step 2: Build it and verify a runnable bundle is produced**

Run: `cd packages/api && bun run build:lib && ls -la dist/server.js`
Expected: `dist/server.js` exists (a single JS file, on the order of a few MB).

**Step 3: Smoke-run the bundle under Bun on a test port**

Run: `cd packages/api && RA_MODE=local RA_PORT=13899 RA_JWT_SECRET=test bun dist/server.js & sleep 3 && curl -s http://localhost:13899/health; kill %1`
Expected: JSON like `{"status":"ok","mode":"local"}`. (If `bun:sqlite`/migrations error, capture output — Risk R3.)

**Step 4: Commit**

```bash
git add packages/api/package.json
git commit -m "feat(api): add build:lib for non-compiled server bundle (Electrobun sidecar)"
```

> The desktop `build:server` script (Task 1) calls the same `bun build --target=bun` directly so the desktop build is self-contained; this api-package script exists for standalone testing.

---

### Task 6: Port the login-shell PATH resolver (with test)

**Files:**
- Create: `packages/desktop/src/bun/shell-path.ts`
- Test: `packages/desktop/src/bun/shell-path.test.ts`

**Step 1: Write the failing test**

```typescript
import { test, expect } from "bun:test";
import { resolveShellPath } from "./shell-path";

test("resolves a non-empty PATH on macOS/Linux", () => {
  if (process.platform === "win32") return; // returns undefined on Windows by design
  const path = resolveShellPath();
  expect(path).toBeTruthy();
  expect(path!.split(":").length).toBeGreaterThan(1);
});
```

**Step 2: Run it; verify it fails** — `bun test src/bun/shell-path.test.ts` → FAIL (module missing).

**Step 3: Implement** (ported verbatim from `packages/electron/src/local-api.ts:23-45`, swapping `execSync` for `node:child_process` which Bun provides):

```typescript
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Recover the user's real login-shell PATH. Finder/LaunchServices-launched
 * apps inherit the stripped launchd PATH; Electrobun's launcher does NOT
 * synthesize a PATH (verified in launcher/main.zig), so this is still required
 * for the spawned API server and its PTYs (claude, git, gh, bun) to find tools.
 */
export function resolveShellPath(): string | undefined {
  if (process.platform === "win32") return undefined;
  const shell = process.env.SHELL || (existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash");
  const DELIM = "__RA_PATH_START__";
  try {
    const out = execSync(`${shell} -ilc 'echo "${DELIM}$PATH"'`, {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const match = out.match(new RegExp(`${DELIM}(.+)`));
    const resolved = match?.[1]?.trim();
    return resolved && resolved.length > 0 ? resolved : undefined;
  } catch {
    return undefined;
  }
}
```

**Step 4: Run the test; verify it passes** — `bun test src/bun/shell-path.test.ts` → PASS.

**Step 5: Commit**

```bash
git add packages/desktop/src/bun/shell-path.ts packages/desktop/src/bun/shell-path.test.ts
git commit -m "feat(desktop): port login-shell PATH resolver with test"
```

---

### Task 7: Port port-finder + health-check (with test)

**Files:**
- Create: `packages/desktop/src/bun/net.ts`
- Test: `packages/desktop/src/bun/net.test.ts`

**Step 1: Write the failing test**

```typescript
import { test, expect } from "bun:test";
import { findAvailablePort, waitForHealth } from "./net";

test("findAvailablePort returns a usable port >= start", async () => {
  const port = await findAvailablePort(13900);
  expect(port).toBeGreaterThanOrEqual(13900);
});

test("waitForHealth resolves when a server reports status ok", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response(JSON.stringify({ status: "ok" }), {
      headers: { "content-type": "application/json" },
    }),
  });
  await waitForHealth(`http://localhost:${server.port}`, 5000);
  server.stop();
});
```

**Step 2: Run it; verify it fails.**

**Step 3: Implement** (`net.ts`) — port `findAvailablePort`/`waitForHealth` from `local-api.ts:82-116`, using `Bun.serve` for the port check and global `fetch`:

```typescript
import { createServer } from "node:net";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => { server.close(); resolve(true); });
    server.listen(port, "127.0.0.1");
  });
}

export async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port in ${startPort}-${startPort + 99}`);
}

export async function waitForHealth(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        if (data.status === "ok") return;
      }
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Local API not healthy within ${timeoutMs}ms`);
}
```

**Step 4: Run the test; verify it passes.**

**Step 5: Commit**

```bash
git add packages/desktop/src/bun/net.ts packages/desktop/src/bun/net.test.ts
git commit -m "feat(desktop): port port-finder and health-check with tests"
```

---

### Task 8: Implement the API server runner (`Bun.spawn` + vendored Bun)

**Files:**
- Create: `packages/desktop/src/bun/local-api.ts`

**Step 1: Implement** (no unit test — needs the real bundle + bundle layout; verified manually in Task 19/20):

```typescript
import { PATHS } from "electrobun/bun";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Subprocess } from "bun";
import { resolveShellPath } from "./shell-path";
import { findAvailablePort, waitForHealth } from "./net";

let apiProcess: Subprocess | null = null;

function resolveServerEntry(): string {
  // Packaged: Contents/Resources/app/server/index.js (runtime cwd is Contents/MacOS).
  const packaged = join(PATHS.RESOURCES_FOLDER, "app", "server", "index.js");
  if (existsSync(packaged)) return packaged;
  // Dev: built into the desktop package by `build:server`.
  return join(import.meta.dir, "..", "..", "dist-server", "index.js");
}

function resolveBunRuntime(): string {
  // Vendored Bun next to the launcher at Contents/MacOS/bun.
  const vendored = join(PATHS.RESOURCES_FOLDER, "..", "MacOS", "bun");
  if (existsSync(vendored)) return vendored;
  return process.execPath; // dev: the Bun running this process
}

export async function startLocalApi(): Promise<string> {
  const port = await findAvailablePort(13590);
  const apiUrl = `http://localhost:${port}`;
  const serverEntry = resolveServerEntry();
  const bun = resolveBunRuntime();

  if (!existsSync(serverEntry)) {
    throw new Error(`Server bundle not found at ${serverEntry}`);
  }

  const shellPath = resolveShellPath();

  apiProcess = Bun.spawn([bun, serverEntry], {
    cwd: join(serverEntry, ".."),
    env: {
      ...process.env,
      ...(shellPath ? { PATH: shellPath } : {}),
      RA_MODE: "local",
      RA_PORT: String(port),
      RA_API_URL: apiUrl,
      RA_JWT_SECRET: "local-mode-secret",
    },
    stdout: "inherit",
    stderr: "inherit",
    onExit(_p, code) {
      console.log(`[local-api] exited with code ${code}`);
      apiProcess = null;
    },
  });

  await waitForHealth(apiUrl);
  console.log(`[local-api] running on ${apiUrl}`);
  return apiUrl;
}

export function stopLocalApi(): void {
  apiProcess?.kill();
  apiProcess = null;
}
```

**Step 2: Typecheck**

Run: `cd packages/desktop && bunx tsc --noEmit`
Expected: no errors. (Functional verification deferred to Task 19.)

**Step 3: Commit**

```bash
git add packages/desktop/src/bun/local-api.ts
git commit -m "feat(desktop): spawn API server via vendored Bun with PATH + health check"
```

---

# Phase 4 — Main process

### Task 9: Main process — window + content loading

**Files:**
- Create: `packages/desktop/src/bun/window.ts`

**Step 1: Implement window creation**

```typescript
import { BrowserWindow } from "electrobun/bun";
import type { Store } from "./store";
import type { DesktopRPC } from "../shared/rpc";
import type { BrowserView } from "electrobun/bun";

const DEV = process.argv.includes("--dev") || process.env.ELECTROBUN_BUILD_ENV === "dev";
const REMOTE = process.argv.includes("--remote");

export function resolveLoadUrl(store: Store): string {
  if (DEV) return REMOTE ? "https://ra.grasco.dev" : "http://localhost:13591";
  const apiUrl = store.get("apiUrl");
  if (store.get("mode") === "local") return apiUrl || "http://localhost:13590";
  return apiUrl || "views://mainview/index.html";
}

export function createWindow(store: Store, rpc: ReturnType<typeof BrowserView.defineRPC<DesktopRPC>>): BrowserWindow {
  const b = store.get("windowBounds");
  const win = new BrowserWindow({
    title: "Remote Agent",
    frame: { x: b.x ?? 0, y: b.y ?? 0, width: b.width, height: b.height },
    titleBarStyle: "hiddenInset", // macOS inset traffic lights; behaves like "hidden" on Win/Linux
    url: resolveLoadUrl(store),
    rpc,
  });
  return win;
}
```

> **Risk R1:** Electron's `minWidth:800/minHeight:600` has no Electrobun equivalent. Accepted limitation; revisit if windows shrink too far. **Risk R2:** `backgroundColor:#0a0a0a` is set in CSS (Task 16), not here.

**Step 2: Typecheck** — `bunx tsc --noEmit` → no errors.

**Step 3: Commit**

```bash
git add packages/desktop/src/bun/window.ts
git commit -m "feat(desktop): window creation with dev/local/remote content loading"
```

---

### Task 10: External-link routing

**Files:**
- Modify: `packages/desktop/src/bun/window.ts`

**Step 1: Add a handler installer**

```typescript
import { Utils } from "electrobun/bun";

export function installExternalLinkHandlers(win: BrowserWindow, allowedOrigin: string) {
  // Popups / target=_blank -> default browser. Event name not in TS union -> cast.
  win.webview.on("new-window-open" as any, (e: any) => {
    const url = typeof e.detail === "object" ? e.detail.url : e.detail;
    if (url) Utils.openExternal(url);
  });

  // Block cross-origin top-level navigation declaratively; allow same-origin + views.
  win.webview.setNavigationRules([
    `${allowedOrigin}/*`,
    "views://*",
    "^http://*",
    "^https://*",
  ]);

  // Observe blocked navigations and open them externally instead.
  win.webview.on("will-navigate", (e: any) => {
    try {
      if (!e.data.allowed && /^https?:/.test(e.data.url)) Utils.openExternal(e.data.url);
    } catch {}
  });
}
```

> **Risk R6:** `setNavigationRules` precedence ("last match wins") differs from Electron's imperative `preventDefault`. Verify in Task 19 that in-app same-origin navigation still works and only foreign links open externally; tune rules if needed.

**Step 2: Typecheck** → no errors.

**Step 3: Commit**

```bash
git add packages/desktop/src/bun/window.ts
git commit -m "feat(desktop): route external links to default browser"
```

---

### Task 11: Window-bounds persistence

**Files:**
- Modify: `packages/desktop/src/bun/window.ts`

**Step 1: Add bounds-saving wiring (call from main entry)**

```typescript
export function persistBounds(win: BrowserWindow, store: Store) {
  const save = (e: any) => {
    const { x, y, width, height } = e.data;
    const prev = store.get("windowBounds");
    store.set("windowBounds", { x, y, width: width ?? prev.width, height: height ?? prev.height });
  };
  win.on("resize", save);
  win.on("move", save);
}
```

**Step 2: Typecheck** → no errors. **Step 3: Commit**

```bash
git add packages/desktop/src/bun/window.ts
git commit -m "feat(desktop): persist window bounds on resize/move"
```

---

### Task 12: Tray

**Files:**
- Create: `packages/desktop/src/bun/tray.ts`

**Step 1: Implement**

```typescript
import { Tray, Utils } from "electrobun/bun";

export function createTray(onShow: () => void): Tray {
  const tray = new Tray({
    title: "",
    image: "views://assets/trayTemplate.png",
    template: true,
    width: 16,
    height: 16,
  });

  tray.setMenu([
    { type: "normal", label: "Show Window", action: "show-window" },
    { type: "divider" },
    { type: "normal", label: "Quit", action: "quit" },
  ]);

  tray.on("tray-clicked", (e: any) => {
    const action = e.data?.action;
    if (action === "" || action === "show-window") {
      onShow(); // bare icon click OR menu item
      return;
    }
    if (action === "quit") {
      tray.remove();
      Utils.quit();
    }
  });

  return tray;
}
```

**Step 2: Typecheck** → no errors. **Step 3: Commit**

```bash
git add packages/desktop/src/bun/tray.ts
git commit -m "feat(desktop): system tray with Show Window / Quit"
```

---

### Task 13: RPC handlers

**Files:**
- Create: `packages/desktop/src/bun/rpc.ts`

**Step 1: Implement handlers**

```typescript
import { BrowserView, Utils } from "electrobun/bun";
import { homedir } from "node:os";
import type { Store } from "./store";
import type { DesktopRPC } from "../shared/rpc";

export function createRpc(store: Store) {
  return BrowserView.defineRPC<DesktopRPC>({
    maxRequestTime: 15000,
    handlers: {
      requests: {
        getApiUrl: () => store.get("apiUrl"),
        setApiUrl: ({ url }) => { store.set("apiUrl", url); },
        getMode: () => store.get("mode"),
        setMode: ({ mode }) => { store.set("mode", mode); },
        checkConnection: async ({ url }) => {
          try {
            const res = await fetch(`${url.replace(/\/$/, "")}/health`);
            if (res.ok) {
              const data = (await res.json()) as Record<string, unknown>;
              if (data.status === "ok") return { ok: true, mode: data.mode as string };
            }
            return { ok: false, error: `Server responded ${res.status}` };
          } catch (err: any) {
            return { ok: false, error: err?.message || "Connection failed" };
          }
        },
        selectFolder: async ({ defaultPath }) => {
          const paths = await Utils.openFileDialog({
            startingFolder: defaultPath || `${homedir()}/`,
            canChooseFiles: false,
            canChooseDirectory: true,
            allowsMultipleSelection: false,
          });
          // CANCEL GOTCHA: openFileDialog returns [""] (not []) on cancel.
          if (!paths.length || paths[0] === "") return { canceled: true, path: null };
          return { canceled: false, path: paths[0] };
        },
      },
      messages: {},
    },
  });
}
```

**Step 2: Typecheck** → no errors. **Step 3: Commit**

```bash
git add packages/desktop/src/bun/rpc.ts
git commit -m "feat(desktop): RPC handlers for settings, connection, folder picker"
```

---

### Task 14: Main entry — wire it together

**Files:**
- Create: `packages/desktop/src/bun/index.ts`

**Step 1: Implement the entrypoint** (runs at boot — no `app.whenReady`)

```typescript
import Electrobun, { Utils } from "electrobun/bun";
import { createStore } from "./store";
import { createRpc } from "./rpc";
import { createWindow, installExternalLinkHandlers, persistBounds, resolveLoadUrl } from "./window";
import { createTray } from "./tray";
import { startLocalApi, stopLocalApi } from "./local-api";

const store = createStore(Utils.paths.userData);
const rpc = createRpc(store);
let win: ReturnType<typeof createWindow> | null = null;

function openWindow() {
  if (win) { win.show(); win.activate(); return; }
  win = createWindow(store, rpc);
  try {
    installExternalLinkHandlers(win, new URL(resolveLoadUrl(store)).origin);
  } catch { /* views:// has no parseable origin; skip */ }
  persistBounds(win, store);
  win.on("close", () => { win = null; });
}

// Boot: start local API if in local mode, then create tray + window.
(async () => {
  if (store.get("mode") === "local") {
    try {
      const apiUrl = await startLocalApi();
      store.set("apiUrl", apiUrl);
    } catch (err: any) {
      console.error("Failed to start local API:", err?.message);
    }
  }
  createTray(openWindow);
  openWindow();
})();

// macOS dock-click / reopen.
Electrobun.events.on("reopen", () => openWindow());

// Kill the API child on quit (Electrobun does not track grandchildren).
Electrobun.events.on("before-quit", () => stopLocalApi());
process.on("exit", () => stopLocalApi());
```

**Step 2: Typecheck** — `cd packages/desktop && bunx tsc --noEmit` → no errors.

**Step 3: Commit**

```bash
git add packages/desktop/src/bun/index.ts
git commit -m "feat(desktop): main process entrypoint wiring API/tray/window/lifecycle"
```

---

# Phase 5 — Renderer + UI integration

### Task 15: Make the UI mountable as a library

**Files:**
- Modify: `packages/ui/src/main.tsx`
- Create: `packages/ui/src/mount.tsx`

**Step 1:** Extract the provider/render tree from `main.tsx` into an exported `mountApp(root: HTMLElement)` in `mount.tsx`, and have `main.tsx` call `mountApp(document.getElementById("root")!)`. (Read `packages/ui/src/main.tsx` first; preserve every provider, the existing `isElectron()` branch, and import order exactly — only move them behind the function.)

**Step 2: Verify the web build still works**

Run: `cd packages/ui && bun run build`
Expected: build succeeds, `dist/index.html` produced, no behavior change.

**Step 3: Commit**

```bash
git add packages/ui/src/main.tsx packages/ui/src/mount.tsx
git commit -m "refactor(ui): expose mountApp() for embedding in desktop shell"
```

> **Decoupling rule:** `packages/ui` must NOT import `electrobun/*`. The Electrobun bridge lives only in `packages/desktop`. The UI continues to detect desktop solely via `window.electronAPI?.isElectron` (its existing mechanism).

---

### Task 16: Desktop renderer — install `electronAPI` shim, then mount UI

**Files:**
- Create: `packages/desktop/src/mainview/bridge.ts`
- Create: `packages/desktop/src/mainview/index.tsx`
- Create: `packages/desktop/src/mainview/index.html`
- Create: `packages/desktop/src/mainview/index.css`

**Step 1: Write `bridge.ts`** — recreate the exact `window.electronAPI` shape from `packages/electron/src/preload.ts` over Electroview RPC:

```typescript
import { Electroview } from "electrobun/view";
import type { DesktopRPC } from "../shared/rpc";

export function installElectronApiShim() {
  const rpc = Electroview.defineRPC<DesktopRPC>({ handlers: { requests: {}, messages: {} } });
  const ev = new Electroview({ rpc });

  (window as any).electronAPI = {
    getApiUrl: () => ev.rpc.request.getApiUrl({}),
    setApiUrl: (url: string) => ev.rpc.request.setApiUrl({ url }),
    checkConnection: (url: string) => ev.rpc.request.checkConnection({ url }),
    selectFolder: (opts?: { title?: string; defaultPath?: string }) =>
      ev.rpc.request.selectFolder(opts ?? {}),
    isElectron: true, // UI's existing detection key — keep it
  };
}
```

**Step 2: Write `index.tsx`** — bridge first, then mount UI:

```typescript
import { installElectronApiShim } from "./bridge";
import "./index.css";

installElectronApiShim();

// Import AFTER the shim so the UI sees window.electronAPI during bootstrap.
const { mountApp } = await import("@remote-agent/ui/mount");
mountApp(document.getElementById("root")!);
```

**Step 3: Write `index.html`** (drives both dev Vite and the bundled view; black background = Risk R2 fix):

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>html,body,#root{height:100%;margin:0;background:#0a0a0a}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./index.tsx"></script>
  </body>
</html>
```

**Step 4: Write `index.css`** — import the UI's global stylesheet so Tailwind applies:

```css
@import "@remote-agent/ui/src/index.css";
```

**Step 5: Add `@remote-agent/ui/mount` + `@remote-agent/ui/src/index.css` export** to `packages/ui/package.json` `exports` (so the subpath imports resolve). Read the file first; add:

```json
"exports": {
  ".": "./src/mount.tsx",
  "./mount": "./src/mount.tsx",
  "./src/index.css": "./src/index.css"
}
```

**Step 6: Typecheck** — `cd packages/desktop && bunx tsc --noEmit` → no errors.

**Step 7: Commit**

```bash
git add packages/desktop/src/mainview packages/ui/package.json
git commit -m "feat(desktop): renderer installs electronAPI shim over RPC and mounts UI"
```

---

### Task 17: Desktop Vite config (Tailwind over UI source)

**Files:**
- Create: `packages/desktop/vite.config.ts`

**Step 1:** Mirror `packages/ui/vite.config.ts` (read it first) — same React + Tailwind plugins, but:
- `root: "src/mainview"`, `build.outDir: "../../dist"` (so it lands at `packages/desktop/dist`, matching `electrobun.config.ts` copy source).
- `server.port: 13591` (the dev URL the main process loads).
- Tailwind `content`/`@source` must include `../../../ui/src/**/*.{ts,tsx}` so UI classes aren't purged.
- Resolve alias `@remote-agent/ui` → `../ui` and the UI's existing `@/` alias → `../ui/src` so its internal imports resolve.

**Step 2: Verify the dev server boots and serves the UI**

Run: `cd packages/desktop && bun run dev:ui` (then open `http://localhost:13591` in a browser)
Expected: the React UI renders styled (Tailwind applied). Note: outside Electrobun, `window.electronAPI` is unset, so the UI shows its non-desktop branch — that's fine for this check. Stop the server.

**Step 3: Verify the production view build emits assets**

Run: `cd packages/desktop && bun run build:ui && ls dist/index.html dist/assets`
Expected: `dist/index.html` + `dist/assets/` exist.

**Step 4: Commit**

```bash
git add packages/desktop/vite.config.ts
git commit -m "feat(desktop): Vite config bundling UI + Tailwind for the Electrobun view"
```

> **Risk R7 (highest):** the Vite/Tailwind-over-workspace-UI wiring (aliases, Tailwind content globs, CSS import) is the most failure-prone task. If classes are missing or aliases break, fall back to: build the UI in `packages/ui` as today and `build.copy` its `dist/` directly, injecting the shim via a small `<script>` added to a copied `index.html` in a `postBuild` hook. Decide within this task; don't carry ambiguity forward.

---

# Phase 6 — Build, run, verify

### Task 18: Dev smoke test (local mode, end to end)

**Files:** none (verification only).

**Step 1: Run the full dev stack**

Run: `cd packages/desktop && bun run build:server && bun run dev`
(`build:server` first so `dist-server/index.js` exists; `dev` runs Vite + `electrobun dev`.)

**Step 2: Observe and record (manual — this is the parity gate):**
- [ ] Window opens, frameless with macOS traffic lights inset, dark background (no white flash beyond first paint).
- [ ] Console shows `[local-api] running on http://localhost:135xx` and the server's own logs (proves vendored-Bun spawn + `bun:sqlite` work).
- [ ] UI loads and is styled; it is in "desktop" mode (uses `window.electronAPI`).
- [ ] Tray icon present; "Show Window" and "Quit" work; bare icon click shows window.
- [ ] A folder-picker action returns a real path; **canceling returns canceled (not an empty-string path)** — exercises the `[""]` gotcha.
- [ ] Clicking an external link opens the default browser, not an in-app window; same-origin nav stays in-app.
- [ ] Resize/move the window, quit, relaunch → bounds restored from `settings.json`.
- [ ] Quit → the API child process is gone (`pgrep -f dist-server/index.js` returns nothing).

**Step 3:** If all boxes pass, commit a short note; otherwise debug per the relevant task before proceeding.

```bash
git commit --allow-empty -m "test(desktop): dev smoke test parity gate passed"
```

---

### Task 19: Production build + measure + verify packaged app

**Files:** none (verification only).

**Step 1: Build the distributable**

Run: `cd packages/desktop && bun run build`
Expected: completes; an `artifacts/` (and/or `build/`) dir appears with a macOS `.app`/`.dmg` and `update.json`.

**Step 2: Measure the size (the whole point of the migration)**

Run: `du -sh packages/desktop/artifacts/* packages/electron/dist/*.dmg 2>/dev/null`
Expected: the Electrobun bundle is dramatically smaller than the Electron `.dmg` (target: well under half). Record the numbers in the PR description.

**Step 3: Launch the packaged `.app` from Finder (NOT the terminal)** — this is the only way to surface the launchd-PATH issue (Risk R4):
- [ ] App launches; window + tray appear.
- [ ] Local API boots — confirm the server found `claude`/`git`/`bun` on PATH (create/run a session that shells out). If "Executable not found in $PATH", the `resolveShellPath` injection regressed.
- [ ] Folder picker, external links, bounds persistence all work as packaged.
- [ ] Settings live under `~/Library/Application Support/com.remote-agent.app/<channel>/settings.json` (verify the path; note the channel segment).

**Step 4: Commit the verification note**

```bash
git commit --allow-empty -m "test(desktop): packaged build verified; size <X>MB vs Electron <Y>MB"
```

---

### Task 20: Code-signing, notarization, and cross-platform notes

**Files:**
- Modify: `packages/desktop/electrobun.config.ts`
- Create: `packages/desktop/SIGNING.md`

**Step 1:** Enable `build.mac.codesign: true` and `build.mac.notarize: true`. Document in `SIGNING.md` the required env vars (NOT committed): `ELECTROBUN_DEVELOPER_ID`, `ELECTROBUN_TEAMID`, and either `ELECTROBUN_APPLEID`/`ELECTROBUN_APPLEIDPASS` or the API-key trio `ELECTROBUN_APPLEAPIKEYPATH`/`ELECTROBUN_APPLEAPIKEY`/`ELECTROBUN_APPLEAPIISSUER`. Note the App-Attest-enabled identifier requirement and the `xattr -cr` unsigned workaround.

**Step 2:** Document the unknowns to resolve before shipping each platform:
- **Risk R8:** whether the **copied `server/index.js`** (and the vendored Bun executing it) needs to be covered by the app's signature/entitlements. Verify a signed build still launches the sidecar (Gatekeeper can kill unsigned executables run by a signed app).
- **Windows:** signing config is undocumented in Electrobun — investigate before a Windows release. GUI builds hide the console; use `ELECTROBUN_CONSOLE=1` to debug.
- **Linux:** `bundleCEF: true` + `defaultRenderer: "cef"` already set (single renderer app-wide; ~100 MB). Output is `Setup.tar.gz` (no AppImage/.deb) — adjust packaging expectations vs the current `AppImage` target.

**Step 3: Commit**

```bash
git add packages/desktop/electrobun.config.ts packages/desktop/SIGNING.md
git commit -m "docs(desktop): code-signing config + cross-platform release notes"
```

> Auto-update (built-in `Updater` + `release.baseUrl`) is **out of scope** for this migration; add it after cutover as a separate plan. `electron-updater` has no equivalent wiring here yet.

---

# Phase 7 — Cutover (do NOT start until Phases 0–6 verified)

### Task 21: Parity sign-off and Electron removal

**Files:**
- Modify: root `package.json` / workspace scripts, CI config
- Delete: `packages/electron` (only after sign-off)

**Step 1:** Confirm the full parity checklist (Tasks 18 + 19 boxes) passes on macOS, and at minimum builds on Windows/Linux. Get explicit user sign-off.

**Step 2:** Point root build/release scripts and CI at `packages/desktop`; remove `packages/electron` from the workspace.

**Step 3:** `git rm -r packages/electron` and update any references (README, scripts, `.github/`).

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: cut over desktop shell from Electron to Electrobun"
```

---

## Open Risks — verify empirically (carry into execution)

| ID | Risk | Where | Mitigation |
|---|---|---|---|
| R1 | No `minWidth/minHeight` in Electrobun | T9 | Accepted limitation; revisit if needed |
| R2 | No `backgroundColor` window option (white flash) | T9/T16 | CSS `body{background:#0a0a0a}`; consider `transparent:true` |
| R3 | Server bundle (`--target=bun`, not `--compile`) must run under vendored Bun incl. `bun:sqlite` + migrations | T5/T8 | Smoke-test bundle standalone (T5.3); no native addons confirmed except externalized playwright |
| R4 | **launchd stripped PATH** in Finder-launched `.app` (claude/git/bun not found) | T19.3 | `resolveShellPath()` ported + injected via spawn env; verify packaged |
| R5 | `build.copy` dest semantics (`views/` vs plain `server/`) and exact runtime paths | T2/T8/T19 | Confirm on first `electrobun build`; adjust `resolveServerEntry()` |
| R6 | `setNavigationRules` ("last match wins") ≠ Electron `preventDefault` | T10/T18 | Tune rules during smoke test |
| R7 | **Vite+Tailwind over workspace UI** (aliases, content globs, CSS) | T16/T17 | Documented fallback: copy UI `dist/` + inject shim via `<script>` in `postBuild` |
| R8 | Signed app may not be allowed to exec the copied server/vendored Bun | T20 | Verify a signed build still spawns the sidecar |
| R9 | `before-quit` (async) vs native 5 s `quitGracefully` timeout may orphan a slow sidecar | T14/T18 | `proc.kill()` on both `before-quit` and `process.on("exit")` |
| R10 | Electrobun is `1.18.x-beta` (pre-1.0 in npm terms) | all | Pin a known-good version once chosen; treat as beta |

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-05-29-electron-to-electrobun-migration.md`. Two execution options:

1. **Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel Session (separate)** — open a new session in a worktree using superpowers:executing-plans, batch execution with checkpoints.

Which approach?
