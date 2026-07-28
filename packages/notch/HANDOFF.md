# packages/notch — notch notification app handoff

Plan: `docs/plans/2026-07-01-swift-notch-app-design.md` (implemented).
Branch: `feat/notch-notifications`. Upstream fork source:
[vibe-notch](https://github.com/farouqaldori/vibe-notch) (Apache-2.0, vendored
window machinery only — see `LICENSE.vibe-notch.md`).

---

## ⚠️ Read this first — verification status

Authored in a **headless Linux sandbox with no Swift toolchain and no
installable deps**, so:

- ❌ **The Swift package has never been compiled.** The window machinery is a
  faithful port of vibe-notch's working code, but expect a handful of
  compiler nits (concurrency annotations, SwiftUI availability) on first
  `swift build`. All fixable in place.
- ❌ **The API changes type-check only by eyeball** — `bun install` fails here,
  so `tsc --noEmit`/`bun run build` were not run. Run them first.
- ❌ The CLAUDE.md "visually test UI before committing" rule could not be
  honored (native macOS UI, no display). Verify visually per below.

## Commits on this branch

```
b11328f feat(notch): macOS notch app for notifications (fork of vibe-notch) [unverified]
fd4574b fix(api): tolerate missing request object in notifications ws auth  [unverified]
358f6c3 feat(api): /ws/notifications bidirectional websocket                [unverified]
4b613c9 feat(api): notification event stream, shared respond, supersede fix [unverified]
```

## Mac verification checklist

1. **API checks**: `bun install`, then in `packages/api`:
   `bunx tsc --noEmit && bun run build` (or the repo's scripts). Fix any nits.
2. **WS smoke test** (no Swift needed):
   ```bash
   bun run dev   # packages/api, port 5100
   # pair a token: log into the web UI, POST /api/machines/pairing-token,
   # then: curl -X POST localhost:5100/api/machines/pair \
   #   -H 'content-type: application/json' -d '{"token":"rapt_…","name":"test"}'
   bunx wscat -c "ws://localhost:5100/ws/notifications?token=ramt_…"
   # expect {"type":"snapshot","data":[…]}; then trigger a Claude session
   # permission prompt and expect a {"type":"notification"} frame.
   # send {"type":"respond","id":"…","action":"approve"} → terminal gets "yes",
   # and a {"type":"resolved"} frame echoes back.
   ```
   Confirm `ws.data.request` is populated in the `open` handler (Elysia
   version dependent) — cookie-session auth and the Bearer-header path both
   rely on it; the `?token=` query path works regardless.
3. **Swift build**: `cd packages/notch && swift build` (macOS 14+). Then
   `swift run` — expect the boot animation (notch expands ~1s then collapses),
   a bell status-bar item, and the settings window opening (unpaired).
4. **Pair + flows**: pair via settings window; then with the notch app running:
   - trigger a permission prompt → notch pops open (sound + bounce), row shows
     Allow/Deny → Allow writes `yes` to the PTY and the row disappears
     (also from the web UI inbox — supersede/resolve events fan out).
   - AskUserQuestion prompt → option buttons from `metadata.options`, plus
     Reply field when freeform is allowed.
   - focus the Electrobun desktop app (`com.remote-agent.app`) and trigger
     another prompt → notch must NOT pop open (badge still updates).
   - keep the web UI focused (presence heartbeat active) → popup suppressed
     via the `userActive` flag on the notification frame.
   - kill the API → status dot goes red, reconnects with backoff; on
     reconnect the snapshot resyncs the list.
5. **Bundle**: `./scripts/make-app.sh` → `build/Remote Agent Notch.app`;
   launch-at-login toggle only works from the bundled app.

## Known gaps / follow-ups

- **PTY menu prompts**: `respond` types the option *label* text + `\n` into
  the terminal. Claude Code menu-style prompts (arrow-key selection) may not
  accept typed labels — if broken, the fix belongs in
  `notificationService.respond` (map option index → arrow-key/number
  sequences), not in the clients.
- The notch shows this machine's notifications only; paired-master
  aggregation (`/notifications/aggregate`) is not bridged into the WS.
- No app icon (accessory app; only visible in the status bar).
- `mark-read` REST route still lacks an ownership check (pre-existing).
