# packages/desktop — Electron→Electrobun migration handoff

Plan: `docs/plans/2026-05-29-electron-to-electrobun-migration.md`.
Branch: `docs/electrobun-migration-plan`. Strategy: **coexist then cutover** —
`packages/electron` keeps shipping until `packages/desktop` reaches verified parity.

---

## ⚠️ Read this first — verification status

Everything below was authored in a **headless Linux aarch64 sandbox that cannot
install deps or build**: `bun install` fails (`tempdir AccessDenied`), the repo's
`node_modules` is incomplete (`react`/`vite`/`firebase-admin`/`electrobun` absent),
there is no display and no macOS toolchain.

- ✅ **Actually verified here:** `src/bun/store.ts`, `shell-path.ts`, `net.ts` —
  **5/5 unit tests pass** (`bun test src/bun/`).
- ❌ **NOT verified (everything else):** all `electrobun/*` glue, the API server
  bundle, the Vite/Tailwind renderer build, the `packages/ui` refactor, and every
  run/package/sign/cutover step. The electrobun code is written against the
  **plan's API cheat-sheet, which was never checked against a real electrobun
  build** — treat all electrobun API usage as TO-CONFIRM.
- The project CLAUDE.md "visually test UI before committing" rule could **not** be
  honored for the UI/renderer commits. Re-check on a Mac.

---

## Commits on this branch (Phase 0–5)

```
ac6514e feat(desktop): renderer shim + Vite/Tailwind config (Tasks 16-17)   [unverified]
14fbdd9 refactor(ui): expose mountApp() for embedding in the desktop shell   [unverified]
888a1f7 feat(desktop): Electrobun main process (rpc/window/tray/api/entry)   [unverified]
a1144ff feat(api): add build:lib for non-compiled server bundle             [unverified]
8cc16b0 feat(desktop): port port-finder and health-check with tests         [TESTED]
3cb25f4 feat(desktop): login-shell PATH resolver with test                  [TESTED]
76a93b1 feat(desktop): JSON settings store with tests                       [TESTED]
52f1958 chore(desktop): scaffold Electrobun package alongside Electron      [structure]
```

## File status map

| File | Status |
|------|--------|
| `src/bun/store.ts` (+test) | ✅ tested |
| `src/bun/shell-path.ts` (+test) | ✅ tested |
| `src/bun/net.ts` (+test) | ✅ tested |
| `src/bun/local-api.ts` | ❌ needs electrobun (`PATHS`) + a built server bundle |
| `src/bun/window.ts` | ❌ needs electrobun (`BrowserWindow`/`Utils`); verify frame/rpc/nav API |
| `src/bun/tray.ts` | ❌ needs electrobun (`Tray`); verify menu/`tray-clicked` shape |
| `src/bun/rpc.ts` | ❌ needs electrobun (`BrowserView.defineRPC`, `Utils.openFileDialog`) |
| `src/bun/index.ts` | ❌ needs electrobun (`Electrobun.events`) |
| `src/shared/rpc.ts` | ❌ needs electrobun `RPCSchema` type |
| `src/mainview/bridge.ts` | ❌ needs electrobun `Electroview`; verify `rpc.request.*` |
| `src/mainview/index.tsx`/`.html`/`.css` | ❌ needs vite build |
| `vite.config.ts` / `tailwind.config.ts` / `postcss.config.js` | ❌ Risk R7, untested wiring |
| `electrobun.config.ts` | ❌ verify `build.copy` dest semantics on first build |
| `packages/ui/src/{main,mount}.tsx`, `packages/ui/package.json` | ❌ verify web build unaffected |
| `packages/api/package.json` (`build:lib`) | ❌ blocked on full install |

---

## Plan corrections already applied (do NOT revert to the plan text)

1. **Spawn env vars** = `REMOTE_AGENT_MODE` / `PORT` / `REMOTE_AGENT_API` /
   `JWT_SECRET=local-mode-secret` (verified vs `packages/electron/src/local-api.ts`
   + `packages/api/src/index.ts`) — NOT the plan's `RA_MODE`/`RA_PORT`/etc.
2. **No `ui-manifest` step** exists in `packages/api` — removed from `build:server`
   and `build:lib`.
3. **`/health`** returns `{ status:"ok", timestamp }` only (no `mode`); `mode` kept
   optional in `checkConnection` for parity with today's Electron behavior.
4. **UI is Tailwind v3 + Vite 5** (plan assumed v4/Vite 6) — desktop
   `vite.config.ts` / `tailwind.config.ts` / `postcss.config.js` / devDep versions
   all match `packages/ui`.

---

## Remaining steps (run on macOS, in order)

### Phase A — install & typecheck
1. `bun install` at repo root (pulls `electrobun` beta + restores all deps).
2. **Confirm the real electrobun API** against the installed beta and fix any
   mismatches, then `cd packages/desktop && bunx tsc --noEmit` until clean.
   Specific things to verify (the plan asserted these without proof):
   - `new BrowserWindow({ frame:{x,y,width,height}, titleBarStyle, url, rpc })`
   - `BrowserView.defineRPC<T>({ maxRequestTime, handlers:{requests,messages} })`
     and the renderer `Electroview` + `ev.rpc.request.*` shape.
   - `Tray({title,image,template,width,height})`, `setMenu`, `tray-clicked` event.
   - `Utils.openFileDialog` options + **cancel returns `[""]`** (not `[]`).
   - `Utils.openExternal`, `win.webview.setNavigationRules`, `new-window-open` /
     `will-navigate` event names.
   - `PATHS.RESOURCES_FOLDER` value + on-disk layout per OS; `Utils.paths.userData`.
   - `Electrobun.events.on("before-quit"|"reopen")`, `Utils.quit()`,
     `runtime.exitOnLastWindowClosed`.

### Phase B — UI/web sanity
3. `bun run --cwd packages/ui build` — confirm the `main.tsx`→`mount.tsx` refactor
   still yields a working web build with no behavior change (visual check).

### Phase C — dev smoke (plan Task 18)
4. `cd packages/desktop && bun run build:server && bun run dev`. Verify:
   window opens (frameless, dark, no white flash); `[local-api] running on …`
   + server logs (proves vendored-Bun spawn + `bun:sqlite`); UI styled & in
   desktop mode; tray Show/Quit + bare-icon click; folder picker returns a path
   and **cancel = canceled (not empty path)**; external links open the system
   browser, same-origin stays in-app; resize/quit/relaunch restores bounds;
   on quit the API child is gone (`pgrep -f dist-server/index.js`).
   - If Tailwind classes are missing / aliases break (**Risk R7**): fall back to
     building the UI in `packages/ui` and `electrobun build.copy` its `dist/`
     directly, injecting the shim via a `<script>` in a `postBuild` hook.

### Phase D — package & verify (plan Task 19)
5. `bun run build`; record bundle size vs the Electron `.dmg`; launch the packaged
   `.app` **from Finder** (not terminal) to surface the launchd-PATH issue
   (**Risk R4** — `resolveShellPath()` should fix it; confirm claude/git/bun
   resolve). Verify `~/Library/Application Support/com.remote-agent.app/<channel>/
   settings.json`.

### Phase E — signing (plan Task 20)
6. Enable `build.mac.codesign`/`notarize` in `electrobun.config.ts`; add
   `SIGNING.md` (env vars: `ELECTROBUN_DEVELOPER_ID`, `ELECTROBUN_TEAMID`, Apple
   ID or API-key trio). Confirm the signed app may still exec the copied server +
   vendored Bun (**Risk R8**). Windows signing is a documented gap; Linux ships
   `bundleCEF` (~100 MB, `Setup.tar.gz`, no AppImage).

### Phase F — cutover (plan Task 21; only after C–E pass on macOS + your sign-off)
Root `package.json` currently has these electron-coupled scripts to repoint
(verified — there is **no CI** and **no README** electron refs to change, and no
`resources/${os}/bun` dir is checked in):
- `build:electron` = `bun run build:ui && bun run --cwd packages/electron dist`
- `dev:electron` = `bun run --cwd packages/electron dev`
- `dev:electron:remote` = `bun run --cwd packages/electron dev:remote`

7. Add `build:desktop`/`dev:desktop` pointing at `packages/desktop`; once parity
   is signed off, make desktop the default and keep `packages/electron` for **one**
   rollback release, then `git rm -r packages/electron` and drop
   `electron`/`electron-builder`/`electron-store`.

---

## Open risks (from the plan, still unresolved)

- **R7** Vite+Tailwind-over-workspace-UI wiring — most likely to break (fallback above).
- **R3** server bundle running under vendored Bun incl. `bun:sqlite` + migrations.
- **R4** launchd-stripped PATH in a Finder-launched `.app`.
- **R5** `build.copy` dest layout / runtime paths (adjust `resolveServerEntry()`).
- **R1** no `minWidth/minHeight` in electrobun (accepted). **R2** no window
  `backgroundColor` (handled via view CSS).
