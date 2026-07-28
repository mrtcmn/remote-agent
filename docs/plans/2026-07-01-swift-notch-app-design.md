# Swift Notch App — Design

Date: 2026-07-01

> **Status (2026-07-14):** implemented on branch `feat/notch-notifications` —
> backend (`notificationEvents`, `/ws/notifications`, shared respond) in
> `packages/api`, Swift app in `packages/notch`. Unverified pending a Mac;
> see `packages/notch/HANDOFF.md`.

## Goal

A macOS notch/menu-bar app (forked from [vibe-notch](https://github.com/farouqaldori/vibe-notch),
native Swift) that surfaces remote-agent notifications in the notch and lets the user
approve/deny/reply directly. It connects to the existing `packages/api` (Elysia/Bun)
notification system over an authenticated **bidirectional WebSocket** — reads events and
sends responses on the same socket.

## Why WebSocket (not polling / FCM)

- The notch both **displays** prompts and **answers** them → one bidirectional channel is cleanest.
- Instant, low-latency events (permission prompts are blocking — the user is waiting).
- Avoids Apple push infra (APNs certs, entitlements, Apple Developer account) that FCM would need
  for a native app.
- The API already has the pattern: `routes/terminal-websocket.ts` subscribes to
  `terminalService.on('output')`. We mirror it for notifications.

## Architecture

```
Swift notch app  ──WS /ws/notifications (Bearer machineToken)──►  Elysia API
     ▲  server→client: snapshot, notification, resolved, dismissed      │
     └──client→server: respond{id,action,text}, dismiss, ping───────────┘
                                                                         │
                              NotificationService (singleton) ──emits──►─┘
                                        │
                              writes "yes"/"no"/text into Claude PTY
```

## Backend changes (packages/api)

### 1. NotificationService becomes an event source
`services/notification/notification.service.ts` — add an `EventEmitter`.
- In `createAndSend()`, after DB write + adapter fan-out, `emit('notification', { userId, record })`.
- On status transitions (resolve/dismiss/supersede), `emit('resolved', {userId, id})` /
  `emit('dismissed', {userId, id})`.

### 2. Extract shared respond logic
Pull the body of `POST /api/notifications/:id/respond` (in `routes/notifications.routes.ts`,
the part that marks resolved and calls `terminalService.write()` with `yes`/`no`/label) into
`respondToNotification(user, id, { action, text })` in the notification service. REST route and
the new WS route both call it — no duplicated PTY-write logic.

### 3. New route: `routes/notification-websocket.ts` → `/ws/notifications`
Register in `routes/index.ts`.
- **Auth (done properly, unlike terminal WS):** resolve `Authorization: Bearer <machineToken>`
  via `machineRegistry.findByToken` in the `open` handler (Swift's `URLSessionWebSocketTask`
  can set headers on the `URLRequest`). Close with a policy code if unauthenticated.
- `open`: send `{ type: "snapshot", data: [ ...pending, sent notifications for user ] }`,
  then subscribe to service events filtered by `userId`.
- server→client messages:
  - `{ type: "snapshot", data: NotificationRecord[] }`
  - `{ type: "notification", data: NotificationRecord }`
  - `{ type: "resolved", id }`
  - `{ type: "dismissed", id }`
- client→server messages:
  - `{ type: "respond", id, action, text? }` → `respondToNotification`
  - `{ type: "dismiss", id }`
  - `{ type: "ping" }` → `{ type: "pong" }`
- `close`: unsubscribe from the emitter.

Auth reference: `auth/middleware.ts` bearer fallback (machine token → owner user).
Machine tokens minted via `services/machine-registry` pairing flow.

## Swift app (forked vibe-notch)

- **Remove** vibe-notch's Unix-socket server + `~/.claude/hooks` installer — the API already
  ingests Claude Code hooks server-side (`routes/internal.routes.ts`). Keep the notch overlay UI.
- `Auth.swift` — redeem a pairing token (generated in the web UI) → obtain long-lived
  `machineToken` → store in Keychain. Server base URL is a setting.
- `NotchSocket.swift` — `URLSessionWebSocketTask` with `Authorization: Bearer` header, ping
  keepalive, auto-reconnect with backoff. Reconnect re-fetches the snapshot, so missed events
  self-heal.
- `Models.swift` — `Codable` structs mirroring `NotificationRecord`
  (`id, sessionId, terminalId, type, title, body, metadata, actions, priority, status`).
- `NotificationStore: ObservableObject` — fed by the socket. Show `pending` + `sent`; remove on
  `resolved`/`dismissed`. Notch action buttons (from `actions`, default Approve/Deny) send
  `respond`; freeform reply sends `respond` with `text`.

## Out of scope (v1)

- FCM/APNs background push (app-quit delivery). Add later if needed.
- Presence heartbeat — optional; an open WS could itself count as "active" to suppress dup FCM.
- Cross-platform (Windows/Linux) — this is macOS-native by design.

## Effort

Backend: 1 new small route file + 2 small edits (emitter, extract respond). Swift: mostly gutting
vibe-notch + one WebSocket client and a store.
