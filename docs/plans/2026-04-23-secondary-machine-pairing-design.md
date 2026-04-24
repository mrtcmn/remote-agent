# Secondary Machine Pairing - Design Document

**Status:** Draft — awaiting review

**Goal:** Let a `local` machine (Electron) pair with a remote `master` using a one-time token, so the user can see what's running where and jump between machines. Each machine keeps its own settings/rules — no sync.

---

## Decisions

### Pairing: One-time token, pasted by user

Master generates a pairing token in its UI (Settings → Machines → "Generate pairing token"). User copies the token, opens local Electron → Settings → "Pair with master", pastes URL + token. Local POSTs to master, receives a long-lived `machineToken`, stores it locally.

No invite links, no QR, no discovery. Just copy-paste.

### No settings/rules sync

Each machine owns its settings. A session runs where it was started and uses that machine's rules. Pairing is purely for **awareness and navigation**, not state replication.

### Direction: Secondary polls master (one-way reachability)

**Only the master is reachable.** Locals/secondaries sit behind NAT and never expose an inbound port. Every request goes secondary → master.

Secondary polls master every 30s over HTTPS with its `machineToken`:
- `POST /machines/heartbeat` — reports "I'm alive" + basic summary (session count, version).
- `GET /machines/me/peers` — fetches list of other machines master knows about + their last-seen status.

Master never calls secondary. If local is offline, master just shows it stale. Master's UI can show locals' status and session count for observability, but cannot "Open" them — there's no URL to hit.

### v1 scope: pair, heartbeat, list, remote-control from local

**In:**
- Pair local ↔ master with a token.
- Heartbeat loop, stale detection (>90s = offline).
- Machines panel in both UIs.
- **Full remote control from local UI** — local UI can list, view, create, stop, and interact with sessions running on a paired master. Everything the user would do by opening master's UI directly, they can do from local.

**Out (deferred):**
- Reverse direction (controlling a local from master) — not possible, local isn't reachable.
- Settings/rule sync.
- Secondary-to-secondary visibility.
- Multi-master aggregation into a single session list (v1: one "current master" selector).

---

## Architecture

### Database (master side)

New table `machines` in `packages/api/src/db/schema.ts`:

```ts
machines: {
  id: text (uuid, pk)
  name: text               // user-editable, e.g. "Murat's MacBook"
  role: text               // 'master' | 'secondary'
  machineToken: text       // hashed, used by secondary to auth back
  pairingToken: text?      // short-lived, consumed on first pair
  pairingExpiresAt: int?
  lastSeenAt: int?
  sessionCount: int        // last reported
  version: text?           // last reported
  createdAt: int
}
```

One row per paired machine. Master has one `role='master'` self-row for symmetry.

### Database (secondary / local side)

SQLite table `paired_masters` (local DB already uses Drizzle per memory):

```ts
paired_masters: {
  id: text (pk)            // master's self-machine id
  url: text                // master's base URL
  name: text
  machineToken: text       // what we use to auth to master
  lastSyncAt: int?
  lastSyncError: text?
}
```

A local can pair with multiple masters (rare but cheap to support). Local does not need a `machines` table — it just re-fetches peers from master on each sync.

### API endpoints (master)

All under `packages/api/src/routes/machines.ts`:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/machines/pairing-token` | user session | Generate short-lived pairing token (15 min TTL). Returns `{ token, masterUrl }`. |
| `POST` | `/machines/pair` | pairing token | Secondary submits `{ pairingToken, name }`. Master creates `machines` row, returns `{ machineId, machineToken }`. Secondary's URL is never stored — it's not reachable. |
| `POST` | `/machines/heartbeat` | machineToken | Secondary reports `{ sessionCount, version }`. Master updates `lastSeenAt`. |
| `GET` | `/machines/me/peers` | machineToken | Returns all machines master knows about + derived `online` flag (`lastSeenAt > now-90s`). |
| `DELETE` | `/machines/:id` | user session | Unpair — revokes token. |

### Services

**Master — `MachineRegistryService`** (`packages/api/src/services/machine-registry/`)
- `generatePairingToken()` → random 32-byte token, stored hashed with expiry.
- `consumePairingToken(token, meta)` → verifies & consumes, creates machine row, issues machineToken.
- `recordHeartbeat(machineId, payload)` → update `lastSeenAt`, `sessionCount`, `version`.
- `listPeers()` → all rows with computed `online` status.
- `revoke(id)` → delete row, invalidate token.

**Secondary — `MasterSyncService`** (`packages/api/src/services/master-sync/`, runs when `mode === 'local'`)
- Timer: every 30s, for each row in `paired_masters`:
  1. POST `/machines/heartbeat` with local session count.
  2. GET `/machines/me/peers`, cache result in memory.
  3. Update `lastSyncAt` or `lastSyncError`.
- Exposes `getPeers()` for the UI to read the cached list.
- On auth failure (401): mark as unpaired, surface in UI.

### UI (`packages/ui`)

**Settings → Machines panel** (both modes):
- **Master mode:** "Generate pairing token" button → shows token + master URL in a copyable card with expiry countdown. Below: list of paired secondaries with name, status dot, last seen, session count, "Rename" / "Unpair" actions. **No "Open" button** — locals aren't reachable from the master.
- **Local mode:** "Pair with master" form (URL + token inputs) → on success adds to paired-masters list. Below: list of paired masters with status + "Open" + "Unpair".

**Top-level Machines widget** (sidebar or header dropdown):
- List of known machines (self + peers), colored dot for online/offline + session count.
- **On master:** status-only for secondaries (observability view — "who's online, what are they running").
- **On local:** clicking a paired master switches the active context to that master — session list, terminals, file browser etc. all render for that remote. A "← Back to local" control returns to the local machine's own context. An "Open in new window" shortcut remains available.
- This is the "scan and report" surface — one glance shows what's up, what's down, what's running where.

### Remote control from local (Elysia plugin proxy)

Local UI never talks to master directly. Every request goes:

```
local UI → local API (mode=local) → master API (bearer: machineToken) → master services
```

**Why proxy and not direct calls:** machineToken stays in the local API (backend), not the renderer. Unified client code — UI always talks to `localhost:13590`, and the local API decides whether to answer from its own services or forward to a master.

**Zero endpoint changes.** The forwarding happens in two Elysia plugins — one on each side. No existing route is touched.

#### Plugin 1 — `machineProxyPlugin` (installed on local API root)

Location: `packages/api/src/plugins/machine-proxy.ts`. Installed in `index.ts` via `.use(machineProxyPlugin)` at the very top, before any routes.

Uses `onRequest` to short-circuit before routing:

```ts
export const machineProxyPlugin = new Elysia({ name: 'machine-proxy' })
  .onRequest(async ({ request, set }) => {
    const url = new URL(request.url);
    const machineId =
      url.searchParams.get('machineId') ??
      request.headers.get('x-machine-id');

    if (!machineId || machineId === SELF_ID) return; // pass through

    const master = await pairedMasters.get(machineId);
    if (!master) {
      set.status = 404;
      return { error: 'unknown machineId' };
    }

    // strip machineId from the forwarded URL
    url.searchParams.delete('machineId');
    const target = `${master.url}${url.pathname}${url.search}`;

    const headers = new Headers(request.headers);
    headers.delete('x-machine-id');
    headers.set('authorization', `Bearer ${master.machineToken}`);
    headers.delete('host');

    return fetch(target, {
      method: request.method,
      headers,
      body: request.body,
      // @ts-expect-error — Bun supports duplex
      duplex: 'half',
    });
  });
```

Returning a `Response` from `onRequest` in Elysia short-circuits the chain — existing routes never run. This is the whole HTTP proxy.

**WebSocket upgrades** need a separate hook because `onRequest` for WS goes through Elysia's `.ws()` handler. Approach: a small dedicated WS-proxy route matching `/ws/*` that opens an outbound `WebSocket` to `${master.url}${path}` with the bearer header, and pipes frames both ways. Lives in the same plugin file.

#### Plugin 2 — `machineTokenAuthPlugin` (installed on master API root)

Location: `packages/api/src/plugins/machine-token-auth.ts`. Installed in `index.ts` on master side via `.use(machineTokenAuthPlugin)` before any routes.

Uses `derive` to detect a machineToken bearer and inject the corresponding user context, so existing auth guards see a normal user session:

```ts
export const machineTokenAuthPlugin = new Elysia({ name: 'machine-token-auth' })
  .derive(async ({ headers }) => {
    const auth = headers.authorization;
    if (!auth?.startsWith('Bearer ')) return {};
    const token = auth.slice(7);

    const machine = await machineRegistry.findByToken(token);
    if (!machine) return {};

    // Promote the machine's "owner user" into request context.
    // Downstream auth guards see a normal user session.
    return {
      user: await users.byId(machine.ownerUserId),
      session: { machineId: machine.id, via: 'machine-token' },
    };
  });
```

Existing session/terminal/file routes continue to read `user`/`session` from context exactly as before — they don't know or care whether it came from a cookie or a machineToken. **No route changes anywhere.**

**UI state:** one piece of global state: `activeMachineId` (defaults to self). A thin `apiFetch()` wrapper reads it and attaches `X-Machine-Id` to every request. All existing session-aware components just keep calling the API as they do today — no per-component changes.

### Config & env

No new env vars. Master URL lives in the `paired_masters` row; machineToken is stored there too (SQLite local-side, protected by OS-level file permissions on the Electron user data dir).

---

## Security notes

- Pairing token is single-use and expires in 15 minutes.
- `machineToken` is stored hashed on master, plaintext on secondary's local SQLite (same trust level as any local credential store). Revocable via the master UI.
- Master treats `machineToken` as a scoped bearer — only the `/machines/*` endpoints accept it, not the regular user API.
- No CSRF concerns because machineToken is only used server-to-server from secondary.

---

## Open questions

1. **Name collisions** — two paired machines with the same name? Suggest prompting for a unique name at pair time.
2. **Clock skew** — use master's clock for `lastSeenAt`, not secondary's, to avoid drift in "online" detection.

---

## Implementation order

1. Master DB migration + `MachineRegistryService` + `/machines/*` routes.
2. Master: add `machineTokenAuthPlugin` — no route changes needed.
3. Master UI: generate pairing token + list paired secondaries.
4. Secondary DB migration + `MasterSyncService` (heartbeat + peer list).
5. Secondary UI: pair form + paired-masters list.
6. Local API: add `machineProxyPlugin` (HTTP short-circuit via `onRequest`) — no route changes needed.
7. Local UI: `activeMachineId` state + machine-switcher + `apiFetch` wrapper attaches `X-Machine-Id`.
8. WebSocket proxy route inside the proxy plugin, piping frames to master.
9. Manual test pass: pair → list remote sessions from local → open a terminal on remote → kill a remote session → unpair → verify 401.
