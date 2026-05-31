# packages/desktop — Electrobun migration handoff

Status of the Electron→Electrobun migration (plan:
`docs/plans/2026-05-29-electron-to-electrobun-migration.md`, packages/desktop).

## ⚠️ Verification status

This package was authored in a **headless Linux aarch64 sandbox that cannot
install dependencies or build** (`bun install` → `tempdir AccessDenied`; the
repo's `node_modules` is incomplete — `react`/`vite`/`firebase-admin`/`electrobun`
etc. are absent). Therefore:

- ✅ **Verified here:** `src/bun/store.ts`, `shell-path.ts`, `net.ts` — pure
  Bun/node code, **5/5 unit tests pass** (`bun test src/bun/`).
- ❌ **NOT verified here (must be done on a Mac with a working install):**
  everything importing `electrobun/*`, the API server bundle, the Vite/Tailwind
  renderer build, and all run/package/sign/cutover steps. The electrobun glue is
  written against the plan's API cheat-sheet, which is itself **unverified vs a
  real electrobun build** — treat API names (`BrowserWindow` frame/rpc options,
  `Tray`, `Utils.openFileDialog`, `Electroview`, `PATHS.RESOURCES_FOLDER`,
  `setNavigationRules`, event names) as **to-confirm**.
- The project CLAUDE.md rule "visually test UI before committing" could **not**
  be satisfied for the `packages/ui` refactor + desktop renderer — no build is
  possible here. Re-run a visual check on a Mac before relying on it.

## Corrections already applied (plan had errors — do NOT revert to the plan text)

1. **API spawn env vars** are `REMOTE_AGENT_MODE` / `PORT` / `REMOTE_AGENT_API` /
   `JWT_SECRET=local-mode-secret` (verified against `packages/electron/src/local-api.ts`
   and `packages/api/src/index.ts`) — NOT the plan's `RA_MODE`/`RA_PORT`/etc.
2. **No `ui-manifest` step** exists in `packages/api` — dropped from `build:server`
   and `build:lib`.
3. **`/health`** returns `{ status: "ok", timestamp }` only (no `mode`); `mode`
   kept optional in checkConnection for parity with today's Electron behavior.
4. **UI is Tailwind v3 + Vite 5** (not v4/Vite 6) — desktop `vite.config.ts`,
   `tailwind.config.ts`, `postcss.config.js`, and devDep versions match that.

## Remaining steps to finish (run on macOS, in order)

1. `bun install` at repo root (pulls electrobun beta + restores all deps).
2. **Confirm the electrobun API** against the installed beta and fix any
   mismatches in `src/bun/*` and `src/mainview/bridge.ts`. Then
   `cd packages/desktop && bunx tsc --noEmit` until clean.
3. `bun run --cwd packages/ui build` — confirm the `main.tsx`→`mount.tsx` refactor
   still produces a working web build (no behavior change).
4. **Task 18 dev smoke** (plan): `bun run build:server && bun run dev` — verify the
   window, local API spawn + `bun:sqlite`, tray, folder picker (`[""]` cancel),
   external links, bounds persistence, child-process cleanup on quit.
5. **Task 19** `bun run build`; measure bundle vs Electron `.dmg`; launch the
   packaged `.app` **from Finder** to surface the launchd-PATH issue (Risk R4).
6. **Task 20** mac codesign/notarize + `SIGNING.md`.
7. **Task 21** cutover: point root scripts/CI at packages/desktop, keep
   packages/electron one release for rollback, then remove it.

## Highest risks (from the plan, still open)

R7 Vite+Tailwind-over-workspace-UI wiring (most likely to break — fallback:
copy `packages/ui/dist` directly + inject the shim via a postBuild `<script>`);
R3 server bundle running under vendored Bun incl. `bun:sqlite`+migrations;
R4 launchd PATH in a Finder-launched app; R5 `build.copy` layout / runtime paths.
