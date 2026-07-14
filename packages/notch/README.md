# Remote Agent Notch

macOS notch/dynamic-island app that surfaces remote-agent notifications and
lets you approve/deny/reply without leaving whatever you're doing. Connects to
`packages/api` over the authenticated `/ws/notifications` websocket (design:
`docs/plans/2026-07-01-swift-notch-app-design.md`).

- New notifications pop the notch open — unless the Remote Agent desktop app
  (`com.remote-agent.app`) is frontmost or you're active in the web UI.
- Review prompts (permission requests / input required) show inline
  Allow/Deny/option buttons and a freeform reply field, vibe-notch style.
- Status-bar item + a configuration window (server URL, pairing, sound,
  suppression, launch-at-login).

## Build & run (macOS 14+)

```bash
cd packages/notch
swift run                 # dev
./scripts/make-app.sh     # bundles build/Remote Agent Notch.app
```

## Pair

1. Start the API (`bun run dev` in `packages/api`) and open the web UI.
2. Generate a pairing token (Machines → Pair device, or
   `POST /api/machines/pairing-token` with a logged-in session).
3. The notch app opens its settings window on first launch — enter the server
   URL and the `rapt_…` token, hit **Pair**. The long-lived machine token is
   stored in the Keychain.

## Attribution

The notch window machinery (`Window/`, `UI/NotchShape.swift`, parts of
`UI/NotchView.swift`) is adapted from
[vibe-notch](https://github.com/farouqaldori/vibe-notch), licensed
Apache-2.0 — see `LICENSE.vibe-notch.md`. Its local ingestion (Claude hooks
installer, unix socket, JSONL parsing, tmux integration) was removed; this app
is fed exclusively by the remote-agent API.
