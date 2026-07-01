# Flat Multi-Project Sessions Sidebar — Design

**Date:** 2026-06-03
**Status:** Design approved, pending implementation
**Scope:** `packages/ui` (primary) + tiny `packages/api` payload addition

---

## Goal

Use all projects in one window. Specifically: the left sidebar should present **every active session across all projects as a single flat list**, instead of grouping sessions under per-project collapsible headers. Each row is attributed to its project (colored chip + project name). Inactive/terminated sessions are hidden behind an expander.

This is the **navigation-shell** interpretation of "all projects in one window" — not simultaneous multi-project tooling in the center pane (that is a separate, much larger effort; see *Out of scope*).

---

## Key finding: the app is already user-scoped, not project-scoped

The single biggest realization from exploring the codebase:

- **`/sessions/sidebar` already returns every project's sessions** for the user (`packages/api/src/routes/sessions.routes.ts:518-719`, no `projectId` where-clause). The UI *re-imposes* per-project structure purely for display.
- **The notification panel is already global** (`NotificationPanel.tsx` fetches with no project/session filter; `notification.repository.ts:findByUser` is user-scoped). Notifications already carry `metadata.projectName`. **No change needed there.**
- The only true "single-project at a time" chokepoint is `Session.tsx`'s `selectedProjectId → activeProject` tooling pipeline — **out of scope** for this task.

So "list all sessions / all notifications" is mostly a **rendering** change in the sidebar, not a data-layer change.

---

## Decisions (resolved during brainstorming)

| Question | Decision |
|---|---|
| What "one window" means | **Flat sidebar** listing all sessions across projects (navigation only). |
| Which sessions show by default | **Active-only flat** — active/`waiting_input` sessions; inactive behind a `▸ show N inactive sessions` expander. |
| Pure flat vs. toggle | **Grouped↔flat toggle**, persisted in localStorage, **default flat**. `ProjectGroup` + drag-reorder + per-project collapse are retained for grouped mode. |
| Project attribution per row | **Chip + name**: existing colored project chip + project name inline before the branch/session name. |

---

## Approach

**Flatten client-side in the sidebar.** Keep `/sessions/sidebar` returning its grouped shape. Add a flat rendering path in `AppSidebar` that derives a single recency-sorted session array (with project metadata attached) from the existing payload. Grouped mode keeps the current code unchanged.

- *Rejected — new flat API shape:* would break the grouped payload that the toggle still needs; backend already does grouping cheaply.
- *Chosen extension — grouped/flat toggle:* both modes coexist; flat is the default.

---

## Data / API changes

`SidebarSession` carries no timestamp today (`packages/ui/src/lib/api.ts:1299`), so a global "newest-active-first" sort has no key. The DB row already has `session.lastActiveAt` (referenced at `sessions.routes.ts:583`).

1. **`packages/api/src/routes/sessions.routes.ts:666`** — add `lastActiveAt: session.lastActiveAt` to the `sessionDataMap.set(...)` output object. (~1 line.)
2. **`packages/ui/src/lib/api.ts:1299`** — add `lastActiveAt: string;` to the `SidebarSession` interface.

No schema migration. No new endpoints. Project name/color for badges are derived **client-side** by mapping over `data.projects` and attaching `project.id`/`project.name` to each session; color comes from the existing `projectColor(id)` helper (`AppSidebar.tsx:38-43`).

---

## Frontend changes

### 1. Layout state (local to `AppSidebar`)

`layout: 'flat' | 'grouped'` + a `toggleLayout`, persisted in `localStorage` under `sidebar-layout` (default `'flat'`). **Implementation note:** kept as local `useState` inside `AppSidebar` rather than in `useSidebar.ts` — `AppSidebar` is the only consumer, so this avoids threading the value through `Layout.tsx`. (`useSidebar.ts` was therefore *not* modified.)

### 2. `AppSidebar.tsx` — flatten memo + rendering

- New type: `type FlatSession = SidebarSession & { projectId: string | null; projectName: string | null; projectColor: string | null }`.
- New `useMemo` (`flatSessions`) that:
  - iterates `data.projects`, attaching `projectId`/`projectName`/`projectColor` to each session;
  - concats `data.unassignedSessions` (null project fields);
  - splits via the existing `isActiveSession()` into `active[]` and `inactive[]`;
  - sorts each by `lastActiveAt` desc (secondary sort by `id` for stability).
- Keep the existing `activeProjects` memo for grouped mode.
- Rendering branch on `layout`:
  - **`grouped`** → existing `ProjectGroup` rendering (drag handlers, `localProjectOrder`, per-project `+`, "Unassigned" header) — unchanged.
  - **`flat`** → flat `active` `SessionRow`s → expander row `▸ show N inactive sessions` (new `showInactive` state) → flat `inactive` `SessionRow`s when open. No "Unassigned" header (those are just rows with no chip).
- A small toggle control (List icon ↔ Layers icon) near the workspaces/tasks tabs, calling `setLayout`.
- The global **New Session** button (`:484`) is unchanged — project is chosen in `NewSessionModal`, which already accepts no preselection (`preselectedProjectId={null}`).

### 3. `SessionRow` (inline, `AppSidebar.tsx:123`) — project chip + name

Add optional `projectName?: string | null` and `projectColor?: string | null`. When present, render the existing colored-initial chip (reused from `ProjectGroup:233-238`, sized down) followed by the project name, inline before the session/branch name, truncating gracefully. Status dot, type icon, diff stats, and nested service rows are unchanged. (The standalone `SessionRow.tsx` referenced by an earlier exploration pass does **not** exist — `SessionRow` is inline here.)

---

## Edge cases

- **No active but some inactive:** show the expander (and reveal-on-click) instead of the bare "No active sessions" empty state.
- **Unassigned sessions (null project):** rendered as plain rows with no chip/name in flat mode.
- **Long branch + long project name:** project name truncates first; branch name keeps priority.
- **Sort stability:** secondary sort on `id` to avoid row jitter on 30s refetch.
- **Inactive list size:** acceptable for now to render all on expand; revisit a cap/pagination if lists get large.

---

## What we lose / out of scope

- In **flat** mode only: project drag-to-reorder and per-project collapse are not available (they remain in grouped mode).
- **Notification panel:** already global — no change.
- **Session-page multi-project tooling** (simultaneous Git/Files/Run across projects, "split panes"): explicitly **not** this task.
- **Kanban** cross-project view: separate, already largely supported server-side.

---

## Files touched

| File | Change |
|---|---|
| `packages/api/src/routes/sessions.routes.ts` | +`lastActiveAt` in sidebar session payload (~1 line) |
| `packages/ui/src/lib/api.ts` | +`lastActiveAt` on `SidebarSession` |
| `packages/ui/src/lib/sidebar-sessions.ts` | **new** — pure `flattenSidebarSessions` + `isActiveSession` (TDD'd) |
| `packages/ui/src/lib/sidebar-sessions.test.ts` | **new** — 9 unit tests for the flatten/sort/split logic |
| `packages/ui/src/components/AppSidebar.tsx` | flatten memo, flat render path, layout toggle + state, `SessionRow`/`SessionEntry` chip+name |
| `packages/ui/tsconfig.json` | exclude `*.test.ts(x)` from the app build (tests run under `bun test`) |

---

## Future (not now)

- Search/filter box at the top of the flat list (useful once inactive is expanded).
- Per-project filter chips on the flat list.
- Promote the flat list toward the larger "multi-project workspace" vision if desired.
