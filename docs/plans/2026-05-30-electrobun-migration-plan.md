# Migrating the Desktop Shell from Electron to Electrobun — Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a **coexistence-then-cutover migration**: `packages/electron` MUST keep building and shipping until `packages/electrobun` reaches verified parity. Do not delete the Electron package until the final cutover task.

**Goal:** Replace the Electron desktop shell (`packages/electron`, ~424 LOC across `main.ts`/`local-api.ts`/`preload.ts`/`store.ts`) with a new Bun-native [Electrobun](https://blackboard.sh/electrobun/) shell (`packages/electrobun`) that reproduces the **exact** `window.electronAPI` renderer contract (`isElectron`, `getApiUrl`, `setApiUrl`, `checkConnection`, `selectFolder`) and the `.electron-app` acrylic look, so `packages/ui` needs **zero behavioral change** (at most one additive CSS line for draggable regions, plus a per-OS opaque-surface change on non-macOS — see Task 16). The two shells coexist behind a parity gate; Electrobun becomes the default only after a 3-OS QA pass, with Electron retained one release for rollback.

**Why migrate:**
- **Collapse the bundled-bun + child_process machinery.** Electrobun's main process *is* the Bun runtime. The entire `local-api.ts` apparatus — `resolveBunPath()` (bundled `process.resourcesPath/bun` → `which bun` → `~/.bun/bin/bun`), the staged `resources/${os}/bun` binary, and the `child_process.spawn` dance — becomes either a `Bun.spawn` (Option A) or an in-process Elysia `app.listen()` (Option B). `net.fetch` health checks become global `fetch`.
- **Drop the `electron-store` ESM-import hack.** `store.ts` loads `electron-store@10` via `new Function('return import("electron-store")')()` because tsc emits CommonJS. The Electrobun main is native Bun ESM, so config becomes a plain JSON file under `Utils.paths.userData`.
- **Net-new capabilities the app lacks today:** built-in differential auto-update (~4–14KB bsdiff patches), first-class macOS code-signing/notarization, and ~14MB bundles (system webview) vs Electron's ~120MB+ bundled Chromium.

**Architecture:** A new `packages/electrobun` package with an `electrobun.config.ts` and a Bun entrypoint (`src/bun/index.ts`) that owns the native window, tray, config store, navigation rules, RPC handlers, and the local-API lifecycle. The renderer contract is preserved by **two cooperating pieces**: (1) a synchronous **preload** that injects `window.electronAPI` (with `isElectron: true` set *synchronously*, before any UI module evaluates) and overrides `window.open`, and (2) the async RPC transport that backs the 4 async methods (with requests queued until the Electroview connection is ready). The built UI (`packages/ui/dist`) is bundled and served via the `views://` scheme (or loaded from the spawned/mounted API URL in local mode, or `https://ra.grasco.dev` in remote mode) — the same preload runs across **all three** load sources. A macOS-only `bun:ffi` shim (`libMacWindowEffects.dylib`) reproduces the `vibrancy:'under-window'` / `backgroundMaterial:'acrylic'` blur that Electrobun has no public API for; on Windows/Linux there is no blur path, so transparency is gated to macOS-only (Task 16).

**Tech Stack:** Electrobun **pinned exactly `1.18.1`** (RESOURCES_FOLDER export landed in 1.18.0 — see issue #344 note below), Bun 1.3.0 / Zig 0.13.0 toolchain, TypeScript, existing React/Tailwind UI, `bun:ffi` + Objective-C (`xcrun clang++`) for the macOS vibrancy shim, a 3-OS GitHub Actions build matrix (macOS + Windows + Linux runners; **no cross-compilation**, **a Mac is required to build at all**).

> **Note on issue #344 (RESOURCES_FOLDER):** The verification verdicts establish that as of **electrobun >= 1.18.0** (current 1.18.1) `PATHS.RESOURCES_FOLDER` **IS exported and usable** (`import PATHS from 'electrobun/bun'`) per the v1.18.0 changelog and the current Paths docs. The GitHub issue #344 is merely **un-closed** — it is not an open blocker for the export. This plan therefore treats the export as available and does **not** treat #344 as a high-risk blocker for Option A. The only genuine residual unknown is the **Windows/Linux on-disk RESOURCES_FOLDER *layout*** (the docs describe it with macOS-specific language), which Task 12 verifies empirically per OS.

---

## Feature-Parity Matrix

| # | Electron capability (current) | Electrobun approach | Parity | Risk | OS caveat / fallback |
|---|---|---|---|---|---|
| 1 | Frameless + `titleBarStyle:'hiddenInset'` (`main.ts:20-21`) | `new BrowserWindow({ titleBarStyle:'hiddenInset', frame:false })` + `trafficLightOffset` | **full** | low | Re-tune traffic-light position vs `.electron-titlebar h-[38px]` spacer (`AppSidebar.tsx:423`) |
| 2 | `transparent:true` + `backgroundColor:'#00000000'` (`main.ts:22,26`) | `transparent:true`; explicit opaque `backgroundColor` on non-macOS (Task 16) | **partial** | medium | Dropping `backgroundColor` is fine *only on macOS* where vibrancy fills the surface. On Win/Linux (no vibrancy) the absence of an opaque background is exactly what produces the see-through window — must set an opaque background there. NOT unconditionally redundant. |
| 3 | macOS vibrancy/acrylic (`main.ts:23-25`) | **No public API.** `bun:ffi` → `libMacWindowEffects.dylib` (NSVisualEffectView) | **workaround** | **high** | macOS-only; Win/Linux degrade to opaque themed surface. **Gate the whole migration on the Phase-0 spike.** |
| 4 | `minWidth:800/minHeight:600` (`main.ts:18-19`) | **No API** (no `setMinimumSize`, no cancelable `will-resize`) | **gap** | medium | Native FFI min-size per OS is the only non-janky path (from-scratch on all 3 OSes — no native plumbing exists). The `resize`-clamp stopgap is **post-hoc and racy** (see Task 7), not a clean stopgap. |
| 5 | Window bounds persist/restore (`main.ts:35-41` + `store.ts`) | `frame:{x,y,w,h}` on construct; `on('resize'/'move')` → `getFrame()` → `Bun.write` JSON | **workaround** | low | Electron persists `getBounds()` (OUTER window); Electrobun has no `getBounds()`, only `getFrame()`. Coordinate-reference equivalence (outer vs content) is **unverified** — validate on restore & re-center if off-screen. Guard `!isMinimized()/!isMaximized()/!isFullScreen()`; Windows HiDPI (#324). |
| 6 | IPC bridge (`preload.ts` + 5 `ipcMain.handle`) | Synchronous preload injects `window.electronAPI`; 4 async methods over typed RPC | **full** | medium | **`isElectron:true` MUST be set synchronously in the preload** (consumed at module-eval in `main.tsx:20`, `api-config.ts:27-28`, `useTerminal.ts:196,213`). RPC connects post-load — async methods queue until ready. `get-mode`/`set-mode` dropped (no UI consumer). |
| 7 | Persistent config (`store.ts`, electron-store) | JSON in `Utils.paths.userData` with **per-field** merge/validation | **workaround** | low | electron-store applies JSON-schema defaults at the *property* level; a naive `{...DEFAULTS, ...parsed}` spread leaves partial nested objects (e.g. `windowBounds.{width}` without `height`) → `undefined`/NaN into `frame`. Must merge per-field (Task 5). `userData` path includes channel → canary/stable separate config. |
| 8 | Folder dialog (`main.ts:125-136`) | `Utils.openFileDialog({canChooseDirectory:true})` | **full** | low | `createDirectory`/`title` flags unverified (minor UX delta) |
| 9 | Tray + menu (`main.ts:157-194`) | `new Tray(...)` + `setMenu` + `tray-clicked` | **full** | medium | **Linux: tray icon click not delivered** — use a menu item, not icon click, to show window |
| 10 | `shell.openExternal` + nav interception (`main.ts:82-101`) | Override `window.open` in preload + `Utils.openExternal` + `setNavigationRules([glob])` | **partial** | medium | **No `setWindowOpenHandler`** and `window.open(...,'_blank')` / `target="_blank"` anchors do NOT fire `will-navigate`. Must override `window.open` in the preload (route external URLs to `openExternal`, return null). `will-navigate` alone is insufficient (Task 9). |
| 11 | `net.fetch /health` (`main.ts:138-153`, `local-api.ts:65-80`) | Global `fetch` | **full** | low | Strict improvement |
| 12 | Spawn Bun API (`local-api.ts`) | **Option A** `Bun.spawn` (primary; RESOURCES_FOLDER available on >=1.18.0) / **Option B** in-process Elysia | **workaround** | medium | A preserves SIGTERM isolation; B requires `api/src/index.ts` factory refactor. Only residual unknown: Windows/Linux RESOURCES_FOLDER *layout* — verified per-OS in CI (Task 12). |
| 13 | Dev/bundled/remote load modes (`main.ts:44-70`) | `http://localhost:13591` / `https://ra.grasco.dev` / stored apiUrl / `views://ui/index.html` | **full** | medium | The preload is the **only** injection mechanism that works across all 3 sources (`views://`, localhost API, remote https) — a `BrowserWindow.preload`. Bundled static index.html lacks `__ENV__` injection. |
| 14 | Packaging dmg/Setup.zip/tar.gz + extraResources | `electrobun.config.ts` + `build.copy` | **partial** | **high** | mac `.dmg` (1:1); Win `.zip`+Setup.exe (NOT nsis); Linux self-extracting `.tar.gz` (**NOT AppImage**); no cross-compile |
| 15 | Code signing (none today) | macOS first-class; Windows undocumented | **partial** | medium | Net-new; Windows signing is a documented GAP (community tooling) |
| 16 | Auto-update (none today) | Built-in bsdiff differential updater | **partial** | low–med | No regression risk (none today), but **net-new infra**: S3/R2 bucket + signing + `update.json`/patch pipeline. **Must reconcile with the existing in-app UpdateBanner/Settings update UI** (server-driven) — see Task 14 coexistence note. |
| 17 | Multi-OS (macOS/Win/Linux) | macOS 14+/Win 11+/Ubuntu 22.04+; per-OS engines | **partial** | **high** | Drops Win10/older-macOS; WebKitGTK can't do advanced layering → **`bundleCEF` on Linux**; `before-quit` unreliable on Linux WM-close; transparency macOS-only |

---

## File Structure

### New files (`packages/electrobun/`)
- `packages/electrobun/package.json` — Electrobun package config + scripts
- `packages/electrobun/tsconfig.json` — TS config (`module:"ESNext"`, `moduleResolution:"bundler"`, `types:["bun-types"]`)
- `packages/electrobun/electrobun.config.ts` — app/runtime/build/release config (replaces the electron-builder block)
- `packages/electrobun/src/shared/rpc.ts` — single shared `RPCSchema` type (both processes)
- `packages/electrobun/src/bun/index.ts` — Bun main: window, tray, RPC handlers, nav rules, lifecycle
- `packages/electrobun/src/bun/store.ts` — JSON config store in `Utils.paths.userData`, per-field merge (replaces `store.ts`)
- `packages/electrobun/src/bun/local-api.ts` — Option A `Bun.spawn` (or Option B in-process mount) of the Elysia API
- `packages/electrobun/src/bun/vibrancy.ts` — macOS `bun:ffi` loader for `libMacWindowEffects.dylib` (no-op on non-mac)
- `packages/electrobun/src/bun/min-size.ts` — FFI/`resize`-clamp min-size enforcement
- `packages/electrobun/src/bun/platform.ts` — exposes `process.platform` to the renderer (gates transparency on macOS-only)
- `packages/electrobun/src/preload/electron-api.ts` — **synchronous preload**: injects `window.electronAPI` (with `isElectron:true` set synchronously), the platform signal, and the `window.open` override; backs async methods with queued RPC
- `packages/electrobun/src/view/index.ts` — view entry: `new Electroview({rpc})` (transport for the preload's queued RPC)
- `packages/electrobun/native/macos/window-effects.mm` — NSVisualEffectView Objective-C source
- `packages/electrobun/test/renderer-contract.test.ts` — **headless contract parity test** (Task 9b)
- `packages/electrobun/assets/trayTemplate.png`, `trayTemplate@2x.png`, `icon.iconset/`, `icon.png` — copied from `packages/electron/assets`

### Modified files
- `packages/ui/src/index.css` — **additive only**: mirror `.app-drag`/`.app-no-drag` onto `.electrobun-webkit-app-region-drag`/`-no-drag`; **gate acrylic/transparent CSS (`241-298`) on a macOS-only class** (Task 16) so Win/Linux render opaque
- `packages/ui/src/hooks/useTerminal.ts` — **gate** `allowTransparency`/`background:'#00000000'` on a macOS-only signal (Task 16) so the terminal is opaque on Win/Linux
- `package.json` (root) — add `electrobun:dev` / `electrobun:build` scripts alongside existing `electron:*`
- `packages/api/src/index.ts` — **Option B only**: refactor into `createApp()`/`startApp()`/`stopApp()` factory (defer `.listen()`, remove top-level `process.on('SIGTERM'/'SIGINT')`, add a value export). Skip entirely if Option A is chosen.
- `docs/superpowers/plans/2026-04-01-electron-app.md` — append a "Superseded by Electrobun" note (final task)
- `docs/plans/2026-04-23-secondary-machine-pairing-design.md` — note the channel-independent per-machine data dir requirement (final task)

### New CI
- `.github/workflows/electrobun-build.yml` — 3-OS native build matrix (the repo has **no** desktop CI today, only `docker-publish.yml`)

### Deleted (final cutover task only, after one rollback release)
- `packages/electron/` (entire package), the staged `resources/${os}/bun` convention, `electron-store`, the ESM-import hack
- Root `electron:dev` / `electron:dev:remote` / `electron:build` scripts

### Unchanged (the renderer contract — do NOT touch)
- `packages/ui/src/lib/electron.ts`, `lib/api-config.ts`, `main.tsx`, `App.tsx`, `SetupScreen.tsx`, `Login.tsx`, `Projects.tsx`, `Terminal.tsx`, `AppSidebar.tsx`. These talk only through `window.electronAPI` (5 members) + the `.electron-app` html class and never import electron. (`index.css` and `useTerminal.ts` ARE touched — additively/gated — per Task 16.)

---

## Coexistence-then-Cutover Strategy

1. **Phase 0 (spikes — gate the whole effort, Tasks 1–2).** Prototype the macOS vibrancy FFI shim against a real Electrobun window *and* the chosen API-hosting model. If the shim is infeasible (and product won't accept opaque-themed Windows/Linux + plain-transparent macOS), **STOP**.
2. **Phase 1 (scaffold + parity, Tasks 3–11).** Build `packages/electrobun` end to end, including the synchronous preload and the headless contract test. `packages/electron` stays untouched and shippable throughout.
3. **Phase 2 (CI/signing/update, Tasks 12–14).** Stand up the 3-OS matrix, signing, and the release bucket — all net-new, disturbs nothing.
4. **Phase 3 (QA, Tasks 15 & 16).** Smoke-test on all three engines (WKWebView / WebView2 / WebKitGTK). Wire and verify the per-OS opaque-surface change. Decide `bundleCEF` per OS.
5. **Phase 4 (cutover, Task 17).** Flip root scripts/CI default to Electrobun, keep `packages/electron` for **one** release as rollback, then delete it in a follow-up.

**Rollback plan:** Until the delete task, `git revert` the root-`package.json` script flip and the CI default change restores Electron with zero code loss — both shells build from the same `packages/ui/dist`. After deletion, rollback = revert the delete commit (Electron sources return verbatim; reinstall `electron`/`electron-builder`/`electron-store`; re-stage `resources/${os}/bun`).

---

## Task 1: Phase-0 Spike — macOS Vibrancy FFI Shim (GATE)

**Goal:** Prove the frosted-glass look survives migration before investing further. This is the single biggest fidelity gap (matrix #3) and can cancel the project.

**Files:** `packages/electrobun/native/macos/window-effects.mm`, `packages/electrobun/src/bun/vibrancy.ts`

- [ ] **Step 1: Scaffold a throwaway Electrobun app** with one transparent `hiddenInset` window (`bunx electrobun init`, or hand-write a minimal `electrobun.config.ts` + `src/bun/index.ts`). Install pinned `electrobun@1.18.1`.

- [ ] **Step 2: Write `native/macos/window-effects.mm`** (ref: `mayfer/electrobun-macos-native-blur`):

```objc
#import <Cocoa/Cocoa.h>
extern "C" void enableWindowVibrancy(void *windowPtr) {
  NSWindow *window = (__bridge NSWindow *)windowPtr;
  NSVisualEffectView *fx = [[NSVisualEffectView alloc] initWithFrame:window.contentView.bounds];
  fx.material = NSVisualEffectMaterialUnderWindowBackground;
  fx.blendingMode = NSVisualEffectBlendingModeBehindWindow;
  fx.state = NSVisualEffectStateActive;
  fx.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [window.contentView addSubview:fx positioned:NSWindowBelow relativeTo:nil];
}
extern "C" void ensureWindowShadow(void *windowPtr) {
  NSWindow *window = (__bridge NSWindow *)windowPtr; window.hasShadow = YES;
}
extern "C" void setWindowTrafficLightsPosition(void *windowPtr, double x, double y) {
  NSWindow *w = (__bridge NSWindow *)windowPtr;
  for (NSWindowButton b : {NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton}) {
    NSButton *btn = [w standardWindowButton:b];
    NSRect f = btn.frame; f.origin.x += x; f.origin.y -= y; btn.frame = f;
  }
}
```

- [ ] **Step 3: Compile the dylib:**

```bash
xcrun clang++ -dynamiclib -fobjc-arc -framework Cocoa \
  packages/electrobun/native/macos/window-effects.mm \
  -o packages/electrobun/src/bun/libMacWindowEffects.dylib
```

- [ ] **Step 4: Write `src/bun/vibrancy.ts`** that null-checks `win.ptr` (it can be null mid-lifecycle per v1.18.0 changelog) and dlopens the dylib only on macOS:

```typescript
import { dlopen, FFIType, suffix } from 'bun:ffi';
import { join } from 'node:path';
import type { BrowserWindow } from 'electrobun/bun';

let lib: ReturnType<typeof dlopen> | null = null;
export function applyVibrancy(win: BrowserWindow): boolean {
  if (process.platform !== 'darwin') return false;        // Win/Linux: no path
  const ptr = win.ptr;                                     // public-in-source, UNDOCUMENTED getter
  if (!ptr) return false;
  if (!lib) lib = dlopen(join(import.meta.dir, `libMacWindowEffects.${suffix}`), {
    enableWindowVibrancy: { args: [FFIType.ptr], returns: FFIType.void },
    ensureWindowShadow:   { args: [FFIType.ptr], returns: FFIType.void },
    setWindowTrafficLightsPosition: { args: [FFIType.ptr, FFIType.f64, FFIType.f64], returns: FFIType.void },
  });
  lib.symbols.enableWindowVibrancy(ptr);
  lib.symbols.ensureWindowShadow(ptr);
  return true;
}
```

- [ ] **Step 5: GATE — verify.** Launch, call `applyVibrancy(win)` **after the window is shown**, screenshot. Assert `win.ptr !== null` and the result is *real frosted glass* (not see-through-to-desktop). Test with macOS "Reduce transparency" both off and on (when on, blur vanishes — confirm a graceful opaque fallback).

```bash
cd packages/electrobun && bunx electrobun dev
# inspect screenshot; assert win.ptr !== null in logs
```

**DECISION:** If the shim works → proceed. If not and product requires frosted glass on all OSes → **STOP and escalate** (Windows acrylic and Linux blur have no path; both degrade to opaque themed surfaces regardless).

- [ ] **Step 6: Commit (on a `feat/electrobun` branch — do not touch `main`):**

```bash
git checkout -b feat/electrobun
git add packages/electrobun/native packages/electrobun/src/bun/vibrancy.ts
git commit -m "spike(electrobun): macOS NSVisualEffectView vibrancy FFI shim"
```

---

## Task 2: Phase-0 Spike — Decide API Hosting Model (GATE)

**Goal:** Choose Option A (`Bun.spawn`) vs Option B (in-process Elysia). Both are viable; A is the safe like-for-like port and is **recommended as primary** now that `PATHS.RESOURCES_FOLDER` is exported (>=1.18.0; the issue #344 ticket is merely un-closed, the export exists).

- [ ] **Step 1: Probe `PATHS.RESOURCES_FOLDER` at runtime** in the spike app, on macOS first:

```typescript
import { PATHS } from 'electrobun/bun';
console.log('RESOURCES_FOLDER =', PATHS.RESOURCES_FOLDER); // must be non-undefined
```

> This probe confirms the export is wired in the pinned build. The export's *existence* is established by the v1.18.0 changelog/Paths docs; the probe guards against an accidental downgrade and is the first half of the per-OS *layout* verification completed in Task 12.

- [ ] **Step 2: Option A dry-run.** `Bun.spawn(['bun','run', join(PATHS.RESOURCES_FOLDER,'app/api/src/index.ts')], { env:{ ...process.env, REMOTE_AGENT_MODE:'local', PORT:'13590' } })`; poll `fetch('http://localhost:13590/health')` for `status:'ok'`; `proc.kill()`. Confirm SIGTERM isolation (kill the API, window stays up).

- [ ] **Step 3: Option B feasibility check (fallback path).** Confirm `packages/api/src/index.ts` is **not** import-safe today: top-level `await originsService.initialize()` (`:47-53`), top-level `.listen(PORT)` (`:126`), `process.on('SIGTERM'/'SIGINT', ()=>process.exit(0))` (`:140-156`), `export type App = typeof app` (`:158`, **type-only**). Option B would require factory-izing it and verifying `better-auth`/`drizzle`/`firebase-admin`/**`playwright`** (heavy, unverified) init inside the Electrobun Bun worker.

- [ ] **Step 4: DECISION.** Default to **Option A** (zero API refactor, preserves SIGTERM isolation). Choose B only if RESOURCES_FOLDER *layout* proves wrong/absent on Windows or Linux in Task 12. Record the choice in the commit message. **Preserve the env-passed `PORT`** — Electron passes `13590` via env while the API default is `5100` (`api/src/index.ts:16`).

- [ ] **Step 5: Commit:**

```bash
git commit --allow-empty -m "spike(electrobun): API hosting = Option A Bun.spawn (RESOURCES_FOLDER ok on macOS)"
```

---

## Task 3: Scaffold the Electrobun Package

**Files:** `packages/electrobun/package.json`, `tsconfig.json`, copy assets

- [ ] **Step 1: Create `packages/electrobun/package.json`:**

```json
{
  "name": "@remote-agent/electrobun",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "electrobun dev",
    "dev:watch": "electrobun dev --watch",
    "build:canary": "electrobun build --env canary",
    "build:stable": "electrobun build --env stable",
    "test": "bun test",
    "tsc": "tsc --noEmit"
  },
  "dependencies": { "electrobun": "1.18.1" },
  "devDependencies": { "bun-types": "^1.3.0", "typescript": "^5.4.0" }
}
```

> **Pin exact `1.18.1`** (no `^`): docs/code drift and `ptr` churn mean upgrades must be deliberate.

- [ ] **Step 2: Create `packages/electrobun/tsconfig.json`:**

```json
{
  "compilerOptions": {
    "target": "ESNext", "module": "ESNext", "moduleResolution": "bundler",
    "lib": ["ESNext", "DOM"], "types": ["bun-types"],
    "strict": true, "skipLibCheck": true, "noEmit": true,
    "esModuleInterop": true, "resolveJsonModule": true
  },
  "include": ["src/**/*", "test/**/*", "electrobun.config.ts"]
}
```

- [ ] **Step 3: Copy icons/tray assets (keep-as-is):**

```bash
mkdir -p packages/electrobun/assets
cp packages/electron/assets/trayTemplate.png packages/electron/assets/trayTemplate@2x.png \
   packages/electron/assets/icon.png packages/electrobun/assets/
# Generate icon.iconset from icon.png for mac signing (Task 13) via iconutil if not present.
```

- [ ] **Step 4: Install + commit:**

```bash
cd packages/electrobun && bun install
git add packages/electrobun/package.json packages/electrobun/tsconfig.json packages/electrobun/assets
git commit -m "feat(electrobun): scaffold package with pinned electrobun 1.18.1 + assets"
```

---

## Task 4: Shared RPC Schema

**Files:** `packages/electrobun/src/shared/rpc.ts`

- [ ] **Step 1: Define the schema** mirroring exactly the 4 renderer-reachable handlers (drop `get-mode`/`set-mode` — `preload.ts` never exposed them and no UI consumes them; drop the dead `mode` field from `check-connection`). `selectFolder` returns `{ canceled, path }` to match the existing contract:

```typescript
import { RPCSchema } from 'electrobun/bun';

export type RAType = {
  bun: RPCSchema<{
    requests: {
      getApiUrl: { params: {}; response: string };
      setApiUrl: { params: { url: string }; response: void };
      checkConnection: { params: { url: string }; response: { ok: boolean; error?: string } };
      selectFolder: {
        params: { title?: string; defaultPath?: string };
        response: { canceled: boolean; path: string | null };
      };
    };
    messages: {};
  }>;
  webview: RPCSchema<{ requests: {}; messages: {} }>;
};
```

- [ ] **Step 2: Verify + commit:**

```bash
cd packages/electrobun && bun run tsc
git add packages/electrobun/src/shared/rpc.ts
git commit -m "feat(electrobun): shared typed RPC schema (4 renderer handlers)"
```

---

## Task 5: JSON Config Store (replaces electron-store)

**Files:** `packages/electrobun/src/bun/store.ts`

- [ ] **Step 1: Create `store.ts`** — hand-rolled JSON under `Utils.paths.userData` (`{appData}/{identifier}/{channel}`). Preserve the `{ mode, apiUrl, windowBounds }` schema **and replicate electron-store's per-property defaulting** — a top-level spread is NOT a 1:1 replacement, because electron-store fills nested property defaults (e.g. `windowBounds.height` even when a partial `{width:900}` is persisted). A naive `{...DEFAULTS, ...parsed}` would leave `windowBounds.height: undefined` and feed NaN into the `BrowserWindow` `frame`:

```typescript
import { Utils } from 'electrobun/bun';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface StoreSchema {
  mode: 'local' | 'remote';
  apiUrl: string;
  windowBounds: { x?: number; y?: number; width: number; height: number };
}
const DEFAULTS: StoreSchema = { mode: 'local', apiUrl: '', windowBounds: { width: 1200, height: 800 } };

// Per-field merge that mirrors electron-store property-level defaults (esp. nested windowBounds).
function withDefaults(parsed: Partial<StoreSchema> | null): StoreSchema {
  const p = parsed ?? {};
  const wb = p.windowBounds ?? {};
  const width = typeof wb.width === 'number' && Number.isFinite(wb.width) ? wb.width : DEFAULTS.windowBounds.width;
  const height = typeof wb.height === 'number' && Number.isFinite(wb.height) ? wb.height : DEFAULTS.windowBounds.height;
  return {
    mode: p.mode === 'remote' || p.mode === 'local' ? p.mode : DEFAULTS.mode,
    apiUrl: typeof p.apiUrl === 'string' ? p.apiUrl : DEFAULTS.apiUrl,
    windowBounds: {
      width, height,
      ...(typeof wb.x === 'number' && Number.isFinite(wb.x) ? { x: wb.x } : {}),
      ...(typeof wb.y === 'number' && Number.isFinite(wb.y) ? { y: wb.y } : {}),
    },
  };
}

let cfg: StoreSchema | null = null;
function cfgPath() { return join(Utils.paths.userData, 'config.json'); }

export async function loadStore(): Promise<StoreSchema> {
  if (cfg) return cfg;
  await mkdir(Utils.paths.userData, { recursive: true });
  cfg = withDefaults(await Bun.file(cfgPath()).json().catch(() => null));
  return cfg;
}
export async function getKey<K extends keyof StoreSchema>(k: K): Promise<StoreSchema[K]> {
  return (await loadStore())[k];
}
export async function setKey<K extends keyof StoreSchema>(k: K, v: StoreSchema[K]): Promise<void> {
  const c = await loadStore(); c[k] = v;
  await Bun.write(cfgPath(), JSON.stringify(c, null, 2));
}
```

> **Caveat (matrix #7):** `userData` includes the *channel*, so canary and stable keep separate config — first canary launch won't see stable's `apiUrl`. The secondary-machine-pairing design assumes a per-machine SQLite/`machineToken` dir; this store's location is channel-scoped, so **keep machine-token storage in a stable, channel-independent path** (addressed in the final docs task).

- [ ] **Step 2: Verify + commit:**

```bash
cd packages/electrobun && bun run tsc
git add packages/electrobun/src/bun/store.ts
git commit -m "feat(electrobun): JSON config store in userData with per-field defaults (drops electron-store + ESM hack)"
```

---

## Task 6: Local API Lifecycle (Option A — Bun.spawn)

**Files:** `packages/electrobun/src/bun/local-api.ts`

- [ ] **Step 1: Create `local-api.ts`** — drop `resolveBunPath()` entirely (the main process IS Bun), keep `findAvailablePort` + global-`fetch` health poll, locate the API via `PATHS.RESOURCES_FOLDER`:

```typescript
import { PATHS } from 'electrobun/bun';
import { createServer } from 'node:net';
import { join } from 'node:path';

let apiProcess: ReturnType<typeof Bun.spawn> | null = null;

function isPortAvailable(p: number) {
  return new Promise<boolean>((res) => {
    const s = createServer();
    s.once('error', () => res(false));
    s.once('listening', () => { s.close(); res(true); });
    s.listen(p, '127.0.0.1');
  });
}
async function findAvailablePort(start: number) {
  for (let p = start; p < start + 100; p++) if (await isPortAvailable(p)) return p;
  throw new Error(`No port in ${start}-${start + 99}`);
}
async function waitForHealth(url: string, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ok = await fetch(`${url}/health`).then(r => r.ok && r.json())
      .then((d: any) => d?.status === 'ok').catch(() => false);
    if (ok) return;
    await Bun.sleep(500);
  }
  throw new Error(`Local API not healthy within ${timeoutMs}ms`);
}

function resolveApiDir(): string {
  // Packaged: copied into RESOURCES_FOLDER/app/api (Task 14). Dev: sibling package.
  const packaged = join(PATHS.RESOURCES_FOLDER ?? '', 'app/api');
  return PATHS.RESOURCES_FOLDER ? packaged : join(import.meta.dir, '..', '..', '..', 'api');
}

export async function startLocalApi(): Promise<string> {
  const apiDir = resolveApiDir();
  const port = await findAvailablePort(13590);   // preserve 13590 base (NOT api default 5100)
  const apiUrl = `http://localhost:${port}`;
  apiProcess = Bun.spawn(['bun', 'run', 'src/index.ts'], {
    cwd: apiDir,
    env: { ...process.env, REMOTE_AGENT_MODE: 'local', PORT: String(port),
           REMOTE_AGENT_API: apiUrl, JWT_SECRET: 'local-mode-secret' },
    stdout: 'inherit', stderr: 'inherit',
  });
  await waitForHealth(apiUrl);
  return apiUrl;
}
export function stopLocalApi() { apiProcess?.kill(); apiProcess = null; }
```

> **Option B fallback (only if Task 2 chose it):** factory-ize `packages/api/src/index.ts` into `createApp()`/`startApp(port)`/`stopApp()`, remove top-level `.listen()` + `process.on('SIGTERM'/'SIGINT')`, add a value export, then `import { startApp } from '../../../api/src'`. Couples API+shell lifecycle (a crash takes the window down) and must verify playwright/firebase-admin/better-auth/drizzle init in-worker. **Commit any API refactor as its own commit** to keep it revertable.

- [ ] **Step 2: Verify + commit:**

```bash
cd packages/electrobun && bun run tsc
git add packages/electrobun/src/bun/local-api.ts
git commit -m "feat(electrobun): local API via Bun.spawn (drops resolveBunPath + net.fetch + bundled bun)"
```

---

## Task 7: Min-Size Enforcement (matrix #4 GAP)

**Files:** `packages/electrobun/src/bun/min-size.ts`

> **Honest framing (corrects an earlier overstatement):** Electrobun has **no** min/max window-size API on any OS — no `minWidth/minHeight`, no `setMinimumSize`, no `setWindowMinimumSize` FFI, and **no cancelable `will-resize` event** (only a post-hoc `resize`). The native layer also has **zero** existing min-size plumbing on macOS/Windows/Linux, so even the FFI path is from-scratch on all three. The clean, non-janky solution is a native FFI min-size setter per OS (`NSWindow.minSize`/`setContentMinSize:`, `WM_GETMINMAXINFO`→`MINMAXINFO.ptMinTrackSize`, `gtk_window_set_geometry_hints`). The `resize`-clamp below is a **genuinely jittery stopgap, not a clean one**: `resize` fires *after* the resize, calling `setFrame` inside it re-feeds the `resize` event, and the busy-flag guard is **racy against fast drags** (the window visibly overshoots then snaps).

- [ ] **Step 1: Implement the resize-clamp stopgap** (debounced/re-entrancy-guarded) as a temporary default, **with a TODO for the real fix** — the per-OS native FFI min-size setter (no task is scheduled for it yet; file a follow-up):

```typescript
import type { BrowserWindow } from 'electrobun/bun';
const MIN_W = 800, MIN_H = 600;
// STOPGAP ONLY — post-hoc + racy against fast drags. Replace with a native FFI min-size setter
// per OS (NSWindow.minSize / WM_GETMINMAXINFO / gtk_window_set_geometry_hints). See follow-up TODO.
export function enforceMinSize(win: BrowserWindow) {
  let busy = false;
  win.on('resize', () => {
    if (busy) return;
    const f = win.getFrame();
    if (f.width < MIN_W || f.height < MIN_H) {
      busy = true;
      win.setFrame(f.x, f.y, Math.max(f.width, MIN_W), Math.max(f.height, MIN_H));
      setTimeout(() => { busy = false; }, 50);   // racy vs fast drag — known limitation
    }
  });
}
```

> **TODO (tracked follow-up, not this PR):** add `ffi.request.setWindowMinimumSize` + `BrowserWindow.setMinimumSize(w,h)` backed by native min-size in all three wrappers (co-locate the macOS path with the vibrancy dylib). Consider upstreaming. Until then, also enforce a CSS `min-width`/`min-height` inside the webview so content degrades gracefully even while the window can still shrink.

- [ ] **Step 2: Commit:**

```bash
cd packages/electrobun && bun run tsc
git add packages/electrobun/src/bun/min-size.ts
git commit -m "feat(electrobun): racy resize-clamp min-size stopgap (no native min-size API; native FFI is the real fix)"
```

---

## Task 8: Bun Main — Window, RPC, Nav Rules, Tray, Lifecycle

**Files:** `packages/electrobun/src/bun/index.ts`

> **RPC-wiring note (corrects earlier mixed API):** in this single-webview app the window has **no embedded `BrowserView`** — the RPC is defined directly on the `BrowserWindow` (mirroring today's Electron `rpc`-on-window). Whether the pinned 1.18.1 exposes `BrowserWindow.defineRPC` vs requiring a `BrowserView` is **unverified**; confirm against the pinned API at implementation time and use the window-level RPC form. The snippet below attaches the RPC object to the `BrowserWindow` constructor (`rpc`) and does **not** mix in a separate `BrowserView`.

- [ ] **Step 1: Create `index.ts`** — port `main.ts` 1:1, mode-by-mode. Note the load-URL branching mirrors `main.ts:44-70` exactly:

```typescript
import { BrowserWindow, Tray, Utils, Electrobun, Updater } from 'electrobun/bun';
import type { RAType } from '../shared/rpc';
import { getKey, setKey } from './store';
import { startLocalApi, stopLocalApi } from './local-api';
import { applyVibrancy } from './vibrancy';
import { enforceMinSize } from './min-size';

let win: BrowserWindow | null = null;

// RPC handlers, attached to the BrowserWindow below via the `rpc` option (no BrowserView in this app).
// Confirm the exact define-RPC entry point against the pinned 1.18.1 API at implementation time.
const rpcHandlers = {
  maxRequestTime: 8000,
  handlers: {
    requests: {
      getApiUrl: () => getKey('apiUrl'),
      setApiUrl: async ({ url }: { url: string }) => { await setKey('apiUrl', url); },
      checkConnection: async ({ url }: { url: string }) => {
        try {
          const r = await fetch(`${url.replace(/\/$/, '')}/health`);
          if (r.ok && (await r.json())?.status === 'ok') return { ok: true };
          return { ok: false, error: `Server responded with status ${r.status}` };
        } catch (e: any) { return { ok: false, error: e?.message || 'Connection failed' }; }
      },
      selectFolder: async (opts: { title?: string; defaultPath?: string }) => {
        const paths = await Utils.openFileDialog({
          startingFolder: opts?.defaultPath, canChooseFiles: false,
          canChooseDirectory: true, allowsMultipleSelection: false, allowedFileTypes: '*',
        });
        return { canceled: !paths?.length, path: paths?.[0] ?? null };
      },
    },
    messages: {},
  },
};

function originGlobs(allowed: string): string[] {
  // same-origin allow + bundled views allow; everything else blocked
  return ['views://*', `${allowed}/*`, `${allowed.replace(/^http/, 'ws')}/*`];
}

async function createWindow() {
  const bounds = await getKey('windowBounds');
  const isDev = process.argv.includes('--dev');
  const isRemote = process.argv.includes('--remote');
  const mode = await getKey('mode');

  // ── Pick load URL (mirrors main.ts:44-70) ──
  let url: string, allowed: string;
  if (isDev) { url = isRemote ? 'https://ra.grasco.dev' : 'http://localhost:13591'; allowed = new URL(url).origin; }
  else if (mode === 'local') { url = (await getKey('apiUrl')) || 'http://localhost:13590'; allowed = new URL(url).origin; }
  else {
    const stored = await getKey('apiUrl');
    if (stored) { url = stored; allowed = new URL(stored).origin; }
    else { url = 'views://ui/index.html'; allowed = 'views://'; }   // dodges file://; layout-independent of #344
  }

  win = new BrowserWindow({
    title: 'Remote Agent',
    url,
    preload: 'views://preload/electron-api.js',   // SYNCHRONOUS injection of window.electronAPI — see Task 9
    frame: { x: bounds.x ?? 0, y: bounds.y ?? 0, width: bounds.width, height: bounds.height },
    titleBarStyle: 'hiddenInset',
    transparent: true,
    // On non-macOS, an opaque backgroundColor avoids a see-through-to-desktop window (Task 16).
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#0b0b0f',
    trafficLightOffset: { x: 16, y: 16 },   // tune vs .electron-titlebar h-[38px] spacer
    navigationRules: originGlobs(allowed),
    rpc: rpcHandlers,
  });

  applyVibrancy(win);   // macOS frosted glass; no-op elsewhere
  enforceMinSize(win);

  // ── Persist bounds (getFrame() reads live native frame) ──
  // NOTE: Electron persisted getBounds() (OUTER window); Electrobun has only getFrame(). The
  // outer-vs-content coordinate equivalence is unverified, so always validate the restored frame
  // against current displays and re-center if off-screen (handled on read in store/createWindow).
  const persist = debounce(() => {
    if (!win || win.isMinimized() || win.isMaximized() || win.isFullScreen()) return;
    setKey('windowBounds', win.getFrame());
  }, 250);
  win.on('resize', persist);
  win.on('move', persist);

  win.on('close', () => { win = null; });
}

function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let t: any; return ((...a: any[]) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }) as T;
}

function createTray() {
  const tray = new Tray({ title: 'Remote Agent', image: 'views://assets/trayTemplate.png',
                          template: true, width: 22, height: 22 });
  tray.setMenu([
    { type: 'normal', label: 'Show Window', action: 'show' },
    { type: 'divider' },
    { type: 'normal', label: 'Quit', action: 'quit' },
  ]);
  tray.on('tray-clicked', (e: any) => {
    const a = e?.data?.action;
    // Linux: icon click (action '') is NOT delivered — rely on the 'Show Window' menu item.
    if (a === 'show' || a === '') win ? win.show() : createWindow();
    else if (a === 'quit') Utils.quit();
  });
}

// ── Lifecycle ──
const mode = await getKey('mode');
if (mode === 'local') {
  try { await setKey('apiUrl', await startLocalApi()); }
  catch (e: any) { console.error('Failed to start local API:', e?.message); }
}
createTray();
await createWindow();

// runtime.exitOnLastWindowClosed:false (in config) keeps the tray app alive with no windows.
Electrobun.events.on('before-quit', async () => { stopLocalApi(); });
// Linux belt-and-suspenders: before-quit doesn't fire on WM-close/Ctrl+C.
process.on('SIGTERM', () => { stopLocalApi(); process.exit(0); });
process.on('SIGINT',  () => { stopLocalApi(); process.exit(0); });
```

> **External-link interception (matrix #10):** there is **no** demonstrated cancel mechanism for Electrobun navigation equivalent to Electron's `event.preventDefault()`, and `window.open(...,'_blank')` / `target="_blank"` anchors do **not** reliably fire `will-navigate`. The plan therefore does **not** rely on a `will-navigate` handler here. Instead, the **preload overrides `window.open`** (Task 9) to route external origins to `Utils.openExternal` via RPC and return `null`, and `navigationRules` blocks cross-origin top-level loads. If the pinned API exposes a `setWindowOpenHandler`/new-window/open-url event, wire it as a second line of defense; otherwise the `window.open` override is the load-bearing mechanism.

> **Lifecycle caveats (matrix #17):** there is no documented `activate`/dock-reopen or `window-all-closed` event. Re-create the window from the **tray menu item**, not a dock click. **This is a genuine macOS UX REGRESSION**, not merely a Linux caveat: on macOS, clicking the Dock icon will **no longer reopen the window** (Electron's `app.on('activate')` has no documented Electrobun equivalent). List it honestly as a macOS behavioral loss until Electrobun documents `activate`. On Linux, `before-quit` does not fire for WM-close/Ctrl+C, hence the raw signal handlers above.

- [ ] **Step 2: Verify + commit:**

```bash
cd packages/electrobun && bun run tsc
git add packages/electrobun/src/bun/index.ts
git commit -m "feat(electrobun): bun main — window, RPC, nav rules, tray, lifecycle (macOS dock-reopen regression noted)"
```

---

## Task 9: Preload — Synchronous `window.electronAPI` Injection (contract preservation, CRITICAL)

**Files:** `packages/electrobun/src/preload/electron-api.ts`, `packages/electrobun/src/view/index.ts`, `packages/electrobun/src/bun/platform.ts`

> **Why this is the single biggest correctness risk.** The UI reads `isElectron()` (which reads `window.electronAPI?.isElectron`) **synchronously at module-evaluation time** in three places that all run **before/at first paint**:
> 1. `packages/ui/src/main.tsx:20` adds the `.electron-app` html class — the trigger for ALL acrylic/transparent CSS (`index.css:241-298`).
> 2. `packages/ui/src/lib/api-config.ts:27-28` sets the initial Zustand `isConfigured: !isElectron()` / `isLoading: isElectron()` at **store-creation time**.
> 3. `packages/ui/src/hooks/useTerminal.ts:196,213` sets `allowTransparency` + xterm `background:'#00000000'`.
>
> RPC connects **after** page load, so an Electroview-based async rebuild of `window.electronAPI` will NOT have `isElectron === true` set when these modules evaluate — the app would lose acrylic styling, terminal transparency, and show the wrong setup/loading state. Therefore `window.electronAPI = { isElectron: true, ... }` **MUST be injected SYNCHRONOUSLY before the UI bundle's first module runs**. An assignment inside an ES module `view/index.ts` does **not** establish ordering vs the UI's own module graph and is insufficient. The injection mechanism is a **`BrowserWindow.preload`** that runs before page scripts, sets `isElectron` (and the platform signal) synchronously, and backs the 4 async methods with queued RPC.

- [ ] **Step 1: Create `src/bun/platform.ts`** — expose the OS to the renderer so transparency can be gated to macOS-only (the renderer otherwise only knows `isElectron`, not the OS). This value is read by the preload and stamped onto the injected API:

```typescript
// Resolved in the Bun main and passed to the preload/view at build/runtime.
export const PLATFORM = process.platform; // 'darwin' | 'win32' | 'linux'
```

- [ ] **Step 2: Create the synchronous preload `src/preload/electron-api.ts`.** It runs **before** any UI module. It sets `isElectron: true` and `platform` **synchronously**, overrides `window.open`, and lazily attaches the Electroview RPC transport so the 4 async methods queue until the connection is ready:

```typescript
// SYNCHRONOUS PRELOAD — must run before the UI bundle's first module evaluates.
// Sets window.electronAPI.isElectron === true literally and synchronously, plus a platform signal,
// and overrides window.open. The 4 async methods are backed by RPC that queues until connected.
import { Electroview } from 'electrobun/view';
import type { RAType } from '../shared/rpc';

// PLATFORM is injected at build time (define/replace) or read from a global the bun main sets.
declare const __PLATFORM__: 'darwin' | 'win32' | 'linux';
const platform = (typeof __PLATFORM__ !== 'undefined' ? __PLATFORM__ : 'darwin');

const rpc = Electroview.defineRPC<RAType>({ handlers: { requests: {}, messages: {} } });
const ev = new Electroview({ rpc });
// ev.rpc.request.* queues calls until the transport connects, so getApiUrl() resolves once ready
// (no hang to maxRequestTime). If the pinned version exposes a `ready`/connection event, the
// async methods may await it before issuing the first request.

const electronAPI = {
  isElectron: true as const,            // literal true — set SYNCHRONOUSLY, this is the whole point
  platform,                             // 'darwin' | 'win32' | 'linux' — gates transparency (Task 16)
  getApiUrl: () => ev.rpc.request.getApiUrl({}),
  setApiUrl: (url: string) => ev.rpc.request.setApiUrl({ url }),
  checkConnection: (url: string) => ev.rpc.request.checkConnection({ url }),
  selectFolder: (opts?: { title?: string; defaultPath?: string }) =>
    ev.rpc.request.selectFolder(opts ?? {}),
};
(window as any).electronAPI = electronAPI;

// ── window.open / _blank external-link handling (matrix #10) ──
// window.open(...,'_blank') and target="_blank" anchors do NOT fire will-navigate, so today's
// shell.openExternal behavior is replicated here: route external URLs to the bun main and suppress
// the in-app window. Same-origin/relative opens fall through to the native behavior.
const nativeOpen = window.open.bind(window);
(window as any).open = (u?: string | URL, target?: string, features?: string) => {
  try {
    if (u) {
      const abs = new URL(String(u), window.location.href);
      if (abs.origin !== window.location.origin) {
        ev.rpc.request.openExternal?.({ url: abs.href }); // see RPC note below
        return null;
      }
    }
  } catch { /* fall through */ }
  return nativeOpen(u as any, target, features);
};
```

> **RPC note:** add an `openExternal: { params: { url: string }; response: void }` request to the shared schema (Task 4) and a handler in the bun main (`openExternal: ({url}) => { Utils.openExternal(url); }`). The `window.open` override is what actually replaces `shell.openExternal` for `_blank`/`window.open` (Session.tsx:452, AppSidebar.tsx:91, Settings.tsx:648/717) and for `target="_blank"` anchors (Settings/McpServers/UpdateBanner/TaskDetailPanel/TaskComments) — `will-navigate` is NOT sufficient for these.

- [ ] **Step 3: Create `src/view/index.ts`** — minimal view entry that just ensures the Electroview transport defined in the preload is constructed in the view context (if the pinned API requires a view-side bootstrap separate from the preload). It does **not** own `isElectron` (the preload does):

```typescript
// View-side bootstrap for the RPC transport. The contract (window.electronAPI, isElectron:true)
// is established by the SYNCHRONOUS preload, NOT here.
import { Electroview } from 'electrobun/view';
import type { RAType } from '../shared/rpc';
export const view = new Electroview<RAType>({ rpc: Electroview.defineRPC({ handlers: { requests: {}, messages: {} } }) });
```

- [ ] **Step 4: Wire the preload across ALL three load sources (matrix #13).** The UI is served three ways — `views://ui/index.html` (bundled), the spawned **local** API URL, and **remote** `https://ra.grasco.dev`. A `BrowserWindow` `preload` is the **only** mechanism that injects across all three (a build-time `<script>` injected into the bundled `index.html` does NOT cover the local/remote HTTP-served cases). Set `preload: 'views://preload/electron-api.js'` on the `BrowserWindow` (Task 8) and confirm it runs in **local mode** (the most common runtime mode) and remote mode, not just `views://`. Verify `window.electronAPI` exists and `isElectron === true` **before** React's `main.tsx` evaluates.

- [ ] **Step 5: Verify + commit:**

```bash
cd packages/electrobun && bun run tsc
git add packages/electrobun/src/preload/electron-api.ts packages/electrobun/src/view/index.ts packages/electrobun/src/bun/platform.ts
git commit -m "feat(electrobun): synchronous preload injects window.electronAPI (isElectron:true) + window.open override across all load modes"
```

---

## Task 9b: Headless Renderer-Contract Parity Test

**Files:** `packages/electrobun/test/renderer-contract.test.ts`

> The renderer contract is the entire point of the migration, yet manual 3-engine QA (Task 15) asserts nothing automatically. Add a headless test that pins the contract shape so regressions fail CI.

- [ ] **Step 1: Write the contract test.** Assert that, after the preload runs, `window.electronAPI` exposes **exactly** the expected members with correct shapes, and that the `.electron-app` class is applied. Drive it via the built UI in a headless webview (or a jsdom harness that imports the preload), checking:
  - `window.electronAPI.isElectron === true` (literal, synchronous).
  - `window.electronAPI.platform` is one of `'darwin' | 'win32' | 'linux'`.
  - The 4 methods exist and are functions: `getApiUrl`, `setApiUrl`, `checkConnection`, `selectFolder`.
  - `selectFolder({})` resolves to an object with `canceled: boolean` and `path: string | null` (mock the RPC).
  - No unexpected extra members beyond the documented contract.
  - `document.documentElement.classList.contains('electron-app')` is true after `main.tsx` runs (or after manually invoking the same `isElectron()`-gated code path).

```typescript
import { test, expect } from 'bun:test';
// Import/evaluate the preload against a window stub, then assert the contract shape.
// Mock the Electroview RPC so checkConnection/selectFolder resolve deterministically.

test('window.electronAPI exposes exactly the 5-member contract with correct shapes', async () => {
  // ... set up window stub + mocked RPC, evaluate preload ...
  const api = (globalThis as any).window.electronAPI;
  expect(api.isElectron).toBe(true);
  expect(['darwin', 'win32', 'linux']).toContain(api.platform);
  for (const m of ['getApiUrl', 'setApiUrl', 'checkConnection', 'selectFolder']) {
    expect(typeof api[m]).toBe('function');
  }
  const res = await api.selectFolder({});
  expect(typeof res.canceled).toBe('boolean');
  expect(res.path === null || typeof res.path === 'string').toBe(true);
});

test('.electron-app class is applied when isElectron is true', async () => {
  // ... run the same isElectron()-gated class toggle as main.tsx:20 ...
  expect((globalThis as any).document.documentElement.classList.contains('electron-app')).toBe(true);
});
```

- [ ] **Step 2: Run + commit:**

```bash
cd packages/electrobun && bun test
git add packages/electrobun/test/renderer-contract.test.ts
git commit -m "test(electrobun): headless renderer-contract parity (isElectron literal, 5 members, .electron-app class)"
```

---

## Task 10: Additive Draggable-Region CSS

**Files:** `packages/ui/src/index.css`

- [ ] **Step 1: Make drag classes additive** so both shells work. Electron uses `-webkit-app-region` (`.app-drag`/`.app-no-drag`, `index.css:233-239`); Electrobun auto-wires `.electrobun-webkit-app-region-drag`/`-no-drag` when `new Electroview()` runs. Add the Electrobun classes to the existing rules without removing anything:

```css
/* Electron: window drag regions */
.app-drag,
.electrobun-webkit-app-region-drag {
  -webkit-app-region: drag;
}
.app-no-drag,
.electrobun-webkit-app-region-no-drag {
  -webkit-app-region: no-drag;
}
```

> The `.electron-app` html class (set in `main.tsx` when `isElectron()` is true) still gates all acrylic CSS (`index.css:241-298`) and fires identically — `window.electronAPI.isElectron === true` is preserved by the synchronous preload (Task 9). The per-OS gating of that acrylic CSS to macOS-only is handled in Task 16.

- [ ] **Step 2: UI testing required.** Per CLAUDE.md, visually verify with the agent-browser skill that the titlebar/drag region and frosted surfaces render before committing.

- [ ] **Step 3: Verify + commit:**

```bash
cd packages/ui && bun run build   # ensure UI still builds
git add packages/ui/src/index.css
git commit -m "feat(ui): additive electrobun drag-region classes (both shells supported)"
```

---

## Task 11: electrobun.config.ts + Root Scripts

**Files:** `packages/electrobun/electrobun.config.ts`, root `package.json`

- [ ] **Step 1: Create `electrobun.config.ts`:**

```typescript
import type { ElectrobunConfig } from 'electrobun';
export default {
  app: { name: 'Remote Agent', identifier: 'com.remote-agent.app', version: '1.0.0' },
  runtime: { exitOnLastWindowClosed: false },   // tray app stays alive (Electron: window-all-closed no-quit on darwin)
  build: {
    bun: { entrypoint: 'src/bun/index.ts' },
    views: {
      view: { entrypoint: 'src/view/index.ts' },
      preload: { entrypoint: 'src/preload/electron-api.ts' },   // SYNCHRONOUS window.electronAPI injection
    },
    copy: {
      '../ui/dist': 'views/ui',                              // served via views://ui/index.html
      'assets/trayTemplate.png': 'views/assets/trayTemplate.png',
      'assets/trayTemplate@2x.png': 'views/assets/trayTemplate@2x.png',
      'src/bun/libMacWindowEffects.dylib': 'app/bun/libMacWindowEffects.dylib',
      '../api': 'app/api',                                   // Option A only: spawnable on disk via RESOURCES_FOLDER
    },
    mac:   { bundleCEF: false, codesign: false, notarize: false, icons: 'assets/icon.iconset' },
    win:   { bundleCEF: false },
    linux: { bundleCEF: true },     // WebKitGTK can't do advanced layering — bundle CEF on Linux (Task 15)
  },
  release: { baseUrl: 'https://<R2-or-S3-bucket>/remote-agent/' },  // S3/R2 for canary (GitHub /latest skips prereleases)
} satisfies ElectrobunConfig;
```

> **Option B:** drop the `'../api': 'app/api'` copy entry (no on-disk API needed). **@2x retina pick** for the tray image is unverified — confirm Electrobun selects `@2x` or reference an explicit asset.

- [ ] **Step 2: Add root scripts (coexist with `electron:*` — do NOT remove them yet):**

```json
"electrobun:dev": "bun run build:ui && cd packages/electrobun && bun run dev",
"electrobun:dev:remote": "bun run build:ui && cd packages/electrobun && bun run dev -- --remote",
"electrobun:build": "bun run build:ui && cd packages/electrobun && bun run build:stable"
```

- [ ] **Step 3: Smoke build + commit:**

```bash
cd packages/electrobun && bunx electrobun build --env dev
git add packages/electrobun/electrobun.config.ts package.json
git commit -m "feat(electrobun): build config (incl. preload entry) + coexisting root scripts"
```

---

## Task 12: CI — 3-OS Native Build Matrix

**Files:** `.github/workflows/electrobun-build.yml`

- [ ] **Step 1: Create the workflow.** There is **no** desktop CI today (only `docker-publish.yml`). No cross-compilation — one runner per OS; a Mac is mandatory:

```yaml
name: electrobun-build
on: { workflow_dispatch: {}, push: { tags: ['v*'] } }
jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - { os: macos-14,     env: stable }
          - { os: windows-2022, env: stable }   # Win 11+ runtime target
          - { os: ubuntu-22.04, env: stable }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: 1.3.0 }
      - name: Linux deps
        if: runner.os == 'Linux'
        run: sudo apt-get update && sudo apt-get install -y build-essential cmake pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev
      - run: bun install
      - run: bun run build:ui
      - name: Compile macOS vibrancy dylib
        if: runner.os == 'macOS'
        run: xcrun clang++ -dynamiclib -fobjc-arc -framework Cocoa packages/electrobun/native/macos/window-effects.mm -o packages/electrobun/src/bun/libMacWindowEffects.dylib
      - name: Renderer-contract test
        run: cd packages/electrobun && bun test
      - run: cd packages/electrobun && bunx electrobun build --env ${{ matrix.env }}
        env:
          ELECTROBUN_DEVELOPER_ID: ${{ secrets.ELECTROBUN_DEVELOPER_ID }}
          ELECTROBUN_TEAMID: ${{ secrets.ELECTROBUN_TEAMID }}
          ELECTROBUN_APPLEID: ${{ secrets.ELECTROBUN_APPLEID }}
          ELECTROBUN_APPLEIDPASS: ${{ secrets.ELECTROBUN_APPLEIDPASS }}
      - uses: actions/upload-artifact@v4
        with: { name: electrobun-${{ matrix.os }}, path: packages/electrobun/build/** }
```

- [ ] **Step 2: Per-OS RESOURCES_FOLDER *layout* verification (matrix #12/#14).** The export itself is confirmed available on >=1.18.0; the only residual unknown is the **on-disk layout on Windows/Linux** (docs describe it with macOS-specific language). In each matrix job, after build, run a one-line probe asserting `PATHS.RESOURCES_FOLDER` resolves **and that `app/api` was actually copied there**. **If the layout is wrong on Windows/Linux → switch that OS (or all) to Option B** and re-run Task 6's fallback.

- [ ] **Step 3: Commit:**

```bash
git add .github/workflows/electrobun-build.yml
git commit -m "ci(electrobun): 3-OS native build matrix + contract test + per-OS RESOURCES_FOLDER layout probe"
```

---

## Task 13: Code Signing + Notarization (macOS)

**Files:** `electrobun.config.ts`, CI secrets

- [ ] **Step 1: Enable macOS signing** (net-new — the app ships unsigned today). Set `build.mac.codesign:true, notarize:true` and provide `ELECTROBUN_*` secrets (App Store Connect API key vars for CI). Document the unsigned fallback for users: `xattr -cr "/Applications/Remote Agent.app"`.

- [ ] **Step 2: Windows signing — document the GAP.** Electrobun has no documented Windows signtool/EV/Azure path. Either accept unsigned Windows (no regression — Electron ships unsigned today) or add a `postPackage` hook invoking `signtool`/community `Catharacta/electrobun-builder`. Record the decision.

- [ ] **Step 3: Commit:**

```bash
git add packages/electrobun/electrobun.config.ts
git commit -m "feat(electrobun): macOS codesign+notarize; document Windows signing gap"
```

---

## Task 14: Built-in Auto-Update + Release Bucket (net-new infra; reconcile with existing in-app update UI)

**Files:** `packages/electrobun/src/bun/index.ts`, release infra

> **Honest cost framing (matrix #16):** auto-update is **net-new infrastructure**, not free "pure gain". There is no auto-update today, so there is no *regression* risk to weigh — but standing it up requires an **S3/R2 bucket, signing, and an `update.json`/patch pipeline** that must be built and maintained. Crucially, the UI **already has its own update surface** — `UpdateBanner.tsx` and the Settings update flow — that is tied to the **server**, not to the desktop shell. Electrobun's built-in updater **must be reconciled** with that existing in-app UI so the two don't conflict (e.g. double "update available" prompts, or the shell relaunching while the server-driven banner says something else). Decide one of: (a) drive the Electrobun updater silently and let the existing UI keep speaking only to the server, (b) surface the Electrobun updater state *through* the existing UpdateBanner via a new RPC method, or (c) defer the built-in updater entirely for v1 and keep the server-driven flow. Record the decision before wiring it.

> **API-surface caveat:** the method names below (`Updater.checkForUpdate()`, `Updater.updateInfo()?.updateReady`, `Updater.applyUpdate()`) are **plausible but UNVERIFIED** — the verdicts confirm the updater *exists* and uses bsdiff differential patches, but the exact method names/shapes were not verified. **Confirm against the pinned 1.18.1 API before treating this as final**; adjust to the real surface.

- [ ] **Step 1: (Decision first)** Pick the coexistence strategy (a/b/c above) for the built-in updater vs the existing `UpdateBanner.tsx`/Settings flow. Document it in the commit.

- [ ] **Step 2: Add an update check** in the Bun main (NAMES UNVERIFIED — confirm against pinned API):

```typescript
import { Updater } from 'electrobun/bun';
// API NAMES UNVERIFIED against 1.18.1 — confirm checkForUpdate/updateInfo/applyUpdate exist & shapes.
await Updater.checkForUpdate();
if (Updater.updateInfo()?.updateReady) await Updater.applyUpdate(); // closes, swaps bundle, relaunches
```

- [ ] **Step 3: Stand up the release bucket.** Point `release.baseUrl` at **S3/R2** (NOT GitHub Releases `/latest` — it skips prereleases, breaking canary auto-update). Add a `postPackage` hook (or CI step) to upload `.tar.zst` + `.patch` + `update.json`. Budget for ongoing bucket/signing maintenance.

- [ ] **Step 4: Commit:**

```bash
git add packages/electrobun/src/bun/index.ts packages/electrobun/electrobun.config.ts
git commit -m "feat(electrobun): built-in differential auto-update via R2 bucket (API names to confirm; reconciled with existing UpdateBanner)"
```

---

## Task 15: 3-Engine QA + bundleCEF Decision

- [ ] **Step 1: macOS (WKWebView).** Verify: frosted glass behind transparent surfaces (vibrancy shim), xterm.js renders (`useTerminal.ts` forces `background:'#00000000'`, `allowTransparency:true` — **macOS path only** after Task 16), `SetupScreen` first-run flow, `Projects.tsx` Browse → `selectFolder`, external links (incl. `window.open`/`_blank`), tray Show/Quit, bounds restore, min-size clamp, local-mode API spawn + health. Confirm `window.electronAPI.isElectron === true` and `.electron-app` class present at first paint (also asserted by the headless test).

- [ ] **Step 2: Windows (WebView2/Chromium).** Same checklist; vibrancy degrades to **opaque themed surface** (no acrylic path). Confirm the terminal/`.electron-app` surfaces are **opaque** (not see-through-to-desktop) — this must be guaranteed by the concrete Task 16 change (opaque `backgroundColor` + macOS-gated transparency CSS + opaque xterm bg), not left as a maybe.

- [ ] **Step 3: Linux (WebKitGTK or CEF).** With `bundleCEF:true` (config) + `renderer:'cef'`, re-verify xterm.js + backdrop-filter CSS (opaque per Task 16). Confirm tray **menu** works (icon-click won't), and that quitting via the tray Quit menu item runs cleanup (`before-quit` won't fire on WM-close).

- [ ] **Step 4: Decide bundleCEF per OS.** Default: system webview on macOS/Windows, CEF on Linux only (pay the ~100MB tax on one platform). If WKWebView breaks the UI, flip macOS to CEF too.

- [ ] **Step 5: Confirm macOS dock-reopen regression.** Explicitly verify that clicking the Dock icon does NOT reopen the window (expected loss) and that the tray "Show Window" menu item does. Note it in QA sign-off.

- [ ] **Step 6: Commit any QA fixes:**

```bash
git add -A
git commit -m "fix(electrobun): per-engine QA fixes (CEF on linux; verify opaque surfaces from Task 16)"
```

---

## Task 16: Per-OS Opaque Surfaces — Gate Transparency on macOS-only (concrete UI/CSS change)

**Files:** `packages/ui/src/index.css`, `packages/ui/src/hooks/useTerminal.ts`

> **Why this is its own task (matrix #2, #17):** on non-macOS the xterm `#00000000` background and `backdrop-filter` over a `transparent` window render **see-through-to-desktop** (no vibrancy/acrylic path on Windows/Linux). The renderer only knows `isElectron`, **not the OS**, so the fix needs a concrete per-OS signal plus a concrete CSS/terminal change — this is **not** a "maybe" and must ship, or the app is broken on Windows/Linux. The platform signal is exposed by the preload as `window.electronAPI.platform` (Task 9, Step 1–2).

- [ ] **Step 1: Add a macOS-only body/html class** where `.electron-app` is set (`main.tsx`), gated on `window.electronAPI?.platform === 'darwin'`:

```typescript
// in main.tsx, alongside the existing isElectron() class toggle:
if (window.electronAPI?.isElectron) document.documentElement.classList.add('electron-app');
if (window.electronAPI?.platform === 'darwin') document.documentElement.classList.add('platform-macos');
```

- [ ] **Step 2: Gate the acrylic/transparent CSS on `.platform-macos`** (`index.css:241-298`). The transparent/`backdrop-filter` rules apply only on macOS; on Windows/Linux fall back to an **opaque** themed surface:

```css
/* macOS: real vibrancy behind a transparent window */
.electron-app.platform-macos .acrylic-surface {
  background: rgba(20, 20, 28, 0.55);
  backdrop-filter: blur(30px) saturate(1.2);
}
/* Windows/Linux (no OS blur): opaque themed surface, never see-through */
.electron-app:not(.platform-macos) .acrylic-surface {
  background: #14141c;          /* opaque */
  backdrop-filter: none;
}
```

- [ ] **Step 3: Gate terminal transparency on macOS** in `useTerminal.ts:196,213` — only request `allowTransparency`/`background:'#00000000'` when `platform === 'darwin'`; otherwise use an opaque terminal background matching the theme:

```typescript
const isMac = window.electronAPI?.platform === 'darwin';
// xterm options:
allowTransparency: isMac,
theme: { ...theme, background: isMac ? '#00000000' : '#14141c' },
```

- [ ] **Step 4: UI testing required.** Per CLAUDE.md, visually verify with agent-browser on each engine that Windows/Linux surfaces are opaque (no desktop bleed-through) and macOS still shows frosted glass.

- [ ] **Step 5: Verify + commit:**

```bash
cd packages/ui && bun run build
git add packages/ui/src/index.css packages/ui/src/hooks/useTerminal.ts
git commit -m "feat(ui): gate transparency/acrylic on macOS-only via electronAPI.platform (opaque on win/linux)"
```

---

## Task 17: End-to-End Smoke Test + Cutover

- [ ] **Step 1: Build the UI:**
```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent && bun run build:ui
```
Expected: `packages/ui/dist/` populated.

- [ ] **Step 2: TypeScript + contract test across the new package:**
```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent/packages/electrobun && bun run tsc && bun test
```
Expected: no errors; renderer-contract test passes.

- [ ] **Step 3: Dev launch (local mode), full flow:**
```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent && bun run electrobun:dev
```
Expected: window opens with frosted glass (macOS) / opaque surface (win/linux); `window.electronAPI.isElectron === true` synchronously at first paint; local API spawns on 13590+ and reports `status:'ok'`; first run shows `SetupScreen`; after connecting, `getApiUrl()` returns the saved URL on relaunch; folder picker, external links (`window.open`/`_blank` route externally), tray, and bounds-restore all work.

- [ ] **Step 4: Stable packaged build on the current host:**
```bash
cd packages/electrobun && bunx electrobun build --env stable
```
Expected: macOS `.dmg` / Windows `.zip`+Setup.exe / Linux self-extracting `.tar.gz` (per host), plus `.tar.zst` + `.patch` + `update.json`.

- [ ] **Step 5: Cutover — make Electrobun the default, KEEP Electron for rollback:**
  - Repoint root `electron:dev`→`electrobun:dev`-equivalent default usage (or update docs/README to use the `electrobun:*` scripts as primary).
  - Make `electrobun-build.yml` the release workflow.
  - **Do NOT delete `packages/electron`** — keep it one release.

```bash
git add package.json README.md
git commit -m "feat: make electrobun the default desktop shell (electron retained for rollback)"
```

- [ ] **Step 6: Update design docs** (final):
  - Append to `docs/superpowers/plans/2026-04-01-electron-app.md`: "Superseded by the Electrobun migration (`packages/electrobun`)."
  - Update `docs/plans/2026-04-23-secondary-machine-pairing-design.md`: the local machine's SQLite/`machineToken` must live in a **stable, channel-independent dir** (Electrobun's `Utils.paths.userData` is channel-scoped → canary/stable would otherwise diverge).

```bash
git add docs/
git commit -m "docs: supersede electron plan; note channel-independent machine-token dir for electrobun"
```

- [ ] **Step 7: Follow-up release — delete Electron** (separate PR, after one rollback release ships): remove `packages/electron/`, the `resources/${os}/bun` staging convention, `electron-store`, and the root `electron:*` scripts. Rollback = revert this delete commit.

```bash
git rm -r packages/electron
# remove electron:* scripts from root package.json
git commit -m "chore: remove legacy electron shell after electrobun rollback window"
```

---

## Open Questions — Decisions for a Human

These are the go/no-go calls a human must make; the tasks above are written to surface each one at the right moment.

1. **Frosted-glass requirement (gates the whole migration).** Is the acrylic/vibrancy look a hard product requirement, or is plain transparency acceptable? It only survives on macOS (via the Task 1 `bun:ffi` NSVisualEffectView shim); Windows acrylic and Linux blur have **no path** and degrade to opaque themed surfaces. Who owns/maintains the shim? → Task 1, matrix #3.
2. **API hosting model — Option A vs B.** Ship the like-for-like `Bun.spawn` subprocess (Option A, recommended) or refactor `packages/api/src/index.ts` into an in-process factory (Option B — couples API+shell lifecycle so an API crash takes the window down, and must prove `playwright`/`firebase-admin`/`better-auth`/`drizzle` init inside the Electrobun Bun worker)? → Tasks 2 & 6.
3. **Distribution formats.** Is the Linux **AppImage** a hard requirement? Electrobun emits a self-extracting `.tar.gz` instead, and Windows `.zip`+Setup.exe rather than NSIS. → matrix #14.
4. **Minimum-OS floor.** Accept dropping users below **macOS 14 / Windows 11 / Ubuntu 22.04** that Electron 33 still supports? → matrix #17.
5. **CI capacity & `bundleCEF`.** Do we have a 3-OS build matrix (a Mac is mandatory; no cross-compilation) and QA budget for WKWebView + WebKitGTK? If UI parity breaks, accept `bundleCEF` (~100MB+, erasing the bundle-size win)? → Tasks 12 & 15.
6. **Bundled-mode `__ENV__` injection.** The pure-bundled `views://ui/index.html` path won't receive the API's runtime `window.__ENV__` (firebase / `VITE_*` config that `api/src/index.ts:35-44` injects). Is that no-API load path actually reachable, and if so how do we inject runtime env there (build-time define, or a tiny local config endpoint)? → matrix #13.
7. **Auto-update coexistence.** Reconcile Electrobun's built-in bsdiff updater with the existing server-driven `UpdateBanner`/Settings update UI — drive it silently, surface it *through* the existing banner via a new RPC, or defer it for v1? → Task 14.
8. **Per-machine data dir.** Electrobun's `Utils.paths.userData` is **channel-scoped** (canary/stable diverge); the secondary-machine-pairing design assumes a stable per-machine SQLite/`machineToken` dir. Move that storage to a channel-independent path? → Task 5; final cutover docs step.
9. **Sustainability / bus-factor.** Comfortable shipping production on a single-maintainer, closed-contribution, rapidly-churning framework (v1.18.x within ~3 months of v1.0), pinned to an exact version? → risks register.

## Risks & Mitigations Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **`isElectron` not set synchronously → lost acrylic/terminal-transparency + wrong setup state** | medium | **critical** | **Synchronous preload** injects `isElectron:true` before any UI module evaluates (Task 9); headless contract test asserts it (Task 9b); verified across all 3 load sources (Task 9 Step 4) |
| macOS vibrancy shim infeasible / `win.ptr` null or churns | medium | **critical** (cancels migration) | Phase-0 GATE (Task 1); pin `1.18.1`; null-check `ptr`, apply after show; smoke-assert blur applied |
| Win/Linux have no blur → see-through windows | high | medium | **Concrete change (Task 16):** opaque `backgroundColor` on non-mac + macOS-gated transparency CSS + opaque xterm bg via `electronAPI.platform`; verified in QA (Task 15) |
| `window.open`/`_blank` external links silently dropped (no `setWindowOpenHandler`, no `will-navigate` fire) | high | medium | **Preload overrides `window.open`** and routes external origins to `Utils.openExternal` via RPC (Task 9); `navigationRules` blocks cross-origin top-level loads |
| macOS dock-reopen lost (no `activate` event) | certain | low–med | **Honest UX regression** — re-open via tray "Show Window" menu item; documented & verified (Tasks 8/15); revisit if Electrobun adds `activate` |
| RPC connects post-load; `getApiUrl()` hangs before first render | medium | high | Preload's RPC queues until connected; gate on Electroview readiness if a `ready` event exists; `maxRequestTime:8000` |
| Config store partial-nested defaults (`windowBounds.height` undefined → NaN frame) | medium | medium | **Per-field merge/validation** in store (Task 5), not a top-level spread |
| Window bounds drift (Electron `getBounds()` outer vs Electrobun `getFrame()` reference unverified) | medium | low | Validate restored frame against current displays, re-center if off-screen (Tasks 5/8); guard min/max/fullscreen; Windows HiDPI (#324) |
| Min-size clamp is racy (post-hoc, re-feeds resize, fights fast drags) | high | low | Stopgap only; real fix is native FFI min-size per OS (tracked TODO, Task 7); CSS min-size inside webview as soft floor |
| Option A: RESOURCES_FOLDER *layout* wrong on Win/Linux | medium | medium | Export is confirmed on >=1.18.0; per-OS CI **layout** probe (Task 12); fall back to Option B factory refactor |
| Option B: playwright/firebase-admin/etc. fail in Electrobun worker; API crash kills shell | medium | high | Prototype Option B before committing (Task 2); prefer Option A |
| WKWebView/WebKitGTK break xterm.js / backdrop-filter | medium | high | 3-engine QA (Task 15); `bundleCEF` escape hatch (Linux default, all if needed) |
| RPC define-on-`BrowserWindow` vs `BrowserView` API unverified | low | medium | Confirm window-level RPC entry point against pinned 1.18.1 (Task 8); no `BrowserView` in this single-webview app |
| Linux tray icon-click & `before-quit` gaps | high | medium | Show window via tray **menu item**; raw SIGTERM/SIGINT cleanup handlers |
| Auto-update is net-new infra + conflicts with existing UpdateBanner/Settings UI | medium | medium | Reconcile built-in updater with server-driven in-app UI (Task 14 decision a/b/c); confirm `Updater.*` API names against 1.18.1 |
| No AppImage; Windows not nsis | high | low–med | Ship `.tar.gz`/`.zip`+Setup.exe; document; community `electrobun-builder`/`appimagetool` if hard-required |
| Min OS bump (macOS 14+/Win 11+/Ubuntu 22.04+) drops users Electron 33 supports | high | medium | Product sign-off before cutover |
| Single-maintainer, closed-PR, churny framework (v1.18.x within ~3mo of v1.0) | certain | medium | Pin exact version; keep Electron one release; isolate Electrobun in one package |
| Windows code signing undocumented | high | low | No regression (unsigned today); optional community signtool hook |

## Multi-OS Support Caveats (summary)
- **Officially:** macOS 14+, Windows 11+, Ubuntu 22.04+ (GTK3 + webkit2gtk-4.1). Other Linux = community.
- **Engines differ:** WKWebView (mac, Safari-family), WebView2/Chromium (Win), WebKitGTK (Linux, Safari-family). Budget QA on all three or pay the `bundleCEF` ~100MB tax.
- **macOS-only:** vibrancy/acrylic (FFI shim) and window transparency (gated via `electronAPI.platform`, Task 16). **macOS dock-reopen is lost** (no `activate` event) — use the tray menu.
- **Linux gaps:** advanced layering needs CEF; tray icon-click not delivered (menu only); application menus unsupported; `before-quit` doesn't fire for WM-close/Ctrl+C.
- **Windows/Linux:** no blur path — surfaces MUST be opaque (Task 16) or they render see-through-to-desktop.
- **Build:** no cross-compilation; a Mac is required to build at all → 3-runner CI matrix.
