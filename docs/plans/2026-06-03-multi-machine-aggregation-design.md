# Multi-Machine Aggregation — One View Across All Connected Machines

**Date:** 2026-06-03
**Status:** Implemented (Phases 1–4) — type-clean, unit-tested, bundles. Cross-machine runtime verification pending a real paired-machine setup.
**Builds on:** `2026-06-03-flat-multi-project-sidebar-design.md` (the per-machine flat session list)

---

## Goal

Stop choosing "This machine" vs a remote one. Show **every connected machine's sessions and notifications together in one window**. The machine picker disappears from the sidebar and survives only where a single machine must be chosen: **New Session** and the **Projects** page.

---

## The decisive architecture fact: federated, not central

Each connected machine is its **own self-contained server + database**. The UI only ever calls its *local* backend (`api.ts:4` → `/api`). Selecting a remote machine doesn't change where requests go — it stamps an `X-Machine-Id` header (`api.ts:31-34`), and the local backend's `machineProxyPlugin` **reverse-proxies the whole request** to that one machine using its stored `machineToken` (`machine-proxy.ts:90-109`). One header → one machine. WebSockets bridge 1:1 via `/ws/proxy/:machineId` (`machine-proxy.ts:147`).

There is **no fan-out today** and **no central store**. Notifications behave identically — they follow the selected machine (`/notifications` is *not* in `LOCAL_ONLY_PREFIXES`, so it proxies).

**Therefore aggregation = the local backend fans out to `self` + every paired master, calls each one's existing endpoint in parallel, tags each result with its machine, and merges.** The fuel already exists: `pairedMastersService.list(userId)` returns every master's `url` + `machineToken` (`paired-masters/index.ts:20`), and the forwarding pattern is proven in the proxy.

---

## Decisions

| Question | Decision |
|---|---|
| Aggregation site | **Server-side** new local-only endpoints (one browser round-trip, parallel upstream, central offline handling). Not client fan-out. |
| Schema | **No migration** — machine is tagged at fetch time. DB rows have no `machineId`. |
| Offline machines | `Promise.allSettled`; one dead machine never breaks the view. Reachable machines render; offline ones show a greyed/collapsed header. |
| Sidebar IA | **Group by machine** — collapsible machine sections (online/offline status), each containing the existing flat-by-project session list. |
| The picker | **Removed from the sidebar.** Machine selection survives only in **New Session** (which machine to create on) and **Projects** (which machine to manage). |
| Per-session actions | Reuse the existing `X-Machine-Id` proxy unchanged: **opening a session auto-targets its machine** (`setActive(session.machineId)`), so terminals/git/files "just work" with zero rewiring. |
| Live multi-machine terminals | **Deferred.** The app shows one session at a time, so the MVP fully covers current UX. Simultaneous live terminals from multiple machines (split view) is out of scope. |

---

## Backend

### New local-only aggregate endpoints
Both added to `LOCAL_ONLY_PREFIXES` so they always run on `self` and fan out (never get proxied to one machine):

- `GET /sessions/sidebar/aggregate` → `AggregatedSidebar`
- `GET /notifications/aggregate` → `AggregatedNotifications`

### Contracts (`api.ts` types)
```ts
interface MachineSidebar { machineId: string; machineName: string; online: boolean; error?: string; data: SidebarData; }
interface AggregatedSidebar { machines: MachineSidebar[]; }   // 'self' first, then paired masters

interface AggregatedNotifications {
  notifications: Array<NotificationRecord & { machineId: string; machineName: string }>; // merged, createdAt desc
  machines: Array<{ machineId: string; machineName: string; online: boolean; error?: string }>;
}
```

### Fan-out helper
1. Extract the inline sidebar builder (`sessions.routes.ts:519-721`) into `buildSidebarData(userId): Promise<SidebarData>` so `self` is computed in-process.
2. `for self`: call the builder / `notificationRepository.findByUser` directly. `machineId='self'`, `machineName='This machine'`.
3. `for each paired master`: `fetch(`${m.url}/api/sessions/sidebar`, { Authorization: 'Bearer '+m.machineToken, 'accept-encoding':'identity' })` (mirrors `machine-proxy.ts:58-64`). Wrap each in `allSettled`; failure → `online:false`.
4. Tag + assemble. The **merge/sort/tag logic is pure** and unit-tested (`mergeNotificationResults`, `assembleSidebar`); the `fetch` I/O is the thin integration shell.

---

## Frontend

### `api.ts`
- `request()` gains an optional `{ machineId }` override → stamps `X-Machine-Id` for that single call (used by New Session / Projects / notification actions to target a specific machine without mutating global state).
- New `getAggregatedSidebar()` / `getAggregatedNotifications()`.

### `active-machine.ts`
- Add the two aggregate paths to `LOCAL_ONLY_PREFIXES`.
- Keep `useActiveMachine`: it now represents "the machine of the session you're viewing," set automatically on session open (not a user-facing switcher).

### `useSidebar.ts`
- `queryFn: api.getAggregatedSidebar`, key `['sidebar-aggregate']`. Returns `AggregatedSidebar`.

### `AppSidebar.tsx`
- Remove `<MachineSwitcher/>`.
- Render top-level **machine sections** (laptop/server icon, name, online dot, collapse chevron; offline → greyed + collapsed). `self` first.
- Within each machine, reuse the existing flat-by-project rendering (`flattenSidebarSessions(machineBlock.data)` + `SessionEntry`) and per-machine inactive expander.
- `handleSelectSession(sessionId, machineId)` → `setActive({machineId, name})` then navigate, so per-session actions proxy to the right machine.

### `NotificationPanel.tsx`
- Consume `getAggregatedNotifications()`; show a small machine indicator next to the existing project badge. Mark-read / respond pass the notification's `machineId` override.

### New Session (`NewSessionModal`) + Projects page
- Add a machine selector (default `self`). Project listing and create calls pass the chosen `machineId` override so they target that machine.

---

## Bugs found during verification

- **Invalid `lastActiveAt` crash (local/SQLite):** some session rows carry an invalid `lastActiveAt`; Drizzle returns an *Invalid Date* object and `.toISOString()` threw, 500-ing the entire sidebar endpoint. Fixed with a defensive `toIsoString()` in `build-sidebar.ts`. Verified: `buildSidebarData` returns all 41 sessions / 6 projects against the live local DB.
- **Stale embedded server:** the desktop dev app spawns a *compiled* server bundle copied from `packages/desktop/dist-server` at startup; `electrobun dev` does NOT run `build:server`. A new vite-served UI calling the new aggregate endpoints against a stale server gets `index.html` (SPA fallback) → `response.json()` throws → "No sessions". **To run new API code in the desktop dev app: `bun run --cwd packages/desktop build:server`, then restart the desktop app.**

## Hard parts / caveats

- **Deep-link refresh to a remote session:** relies on the persisted active machine (same limitation as today). Clicking from the aggregated sidebar always sets it correctly.
- **Offline machine:** rendered as a greyed, collapsed section; its sessions/notifications are simply absent that cycle.
- **Performance:** fan-out × N machines per 30s cycle, parallelized server-side via `allSettled` with per-master timeouts.
- **Verification limit:** cross-machine behavior requires a real paired-machine setup. Locally I can prove the pure merge logic (unit tests), types, and bundle; end-to-end fan-out needs the user's multi-machine environment.

---

## Phases — all done

1. ✅ **Backend** — extracted `buildSidebarData`; `/sessions/sidebar/aggregate` + `/notifications/aggregate`; `fanOutToMasters` (allSettled); pure merge/assemble TDD'd (5 tests).
2. ✅ **Sidebar** — machine-grouped rendering consuming `AggregatedSidebar`; `MachineSwitcher` removed from sidebar; session-open sets active machine; project flat/grouped toggle dropped (machine is now the top grouping, flat-by-project within).
3. ✅ **Notifications** — aggregated panel; machine badge on remote rows; mark-read / respond / mark-all routed to each notification's origin machine; unread count derived from the merged list.
4. ✅ **Picker relocation** — machine selector in `NewSessionModal` (scopes project list + create/worktree); `MachineSwitcher` rendered on the Projects page (drives global active machine, which its existing queries/mutations already follow).

---

## Files touched

| File | Change |
|---|---|
| `packages/api/src/routes/sessions.routes.ts` | extract `buildSidebarData`; add `/sessions/sidebar/aggregate` |
| `packages/api/src/routes/notifications.routes.ts` | add `/notifications/aggregate` |
| `packages/api/src/services/aggregation/*` | **new** — fan-out helper + pure merge/assemble (TDD) |
| `packages/ui/src/lib/api.ts` | `request()` machineId override; aggregate methods + types |
| `packages/ui/src/lib/active-machine.ts` | aggregate paths local-only |
| `packages/ui/src/hooks/useSidebar.ts` | consume aggregate |
| `packages/ui/src/components/AppSidebar.tsx` | machine-grouped render; remove switcher; session-open targeting |
| `packages/ui/src/components/NotificationPanel.tsx` | aggregated notifications + machine-targeted actions |
| `packages/ui/src/components/NewSessionModal.tsx` | machine selector |
| `packages/ui/src/pages/Projects*.tsx` | machine selector |
| `packages/ui/src/components/MachineSwitcher.tsx` | removed from sidebar (kept/repurposed for New Session/Projects) |
