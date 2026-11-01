# Split views — design

Date: 2026-11-01
Status: approved, not implemented

## Goal

Show terminals and tools side by side, like the editor groups of VS Code. Tabs can come from
different sessions and different machines. A split is saved as a named **view** that stays in
the sidebar and survives an app restart.

## Behavior

### When a view is created

- Drag a tab on a session page to a side drop zone of the content area, or drag a session from
  the sidebar into the content area.
- The app creates **"View N"**, opens it at `/views/:id`, and puts the current tab and the
  dropped item side by side.
- The session page does not change. It stays one session, one content area, no splits.

### In the sidebar

- A **Views** group sits at the top of the sidebar, above the machines.
- Each entry shows the view name and a chip for each session in it.
- Click opens the view. Double-click renames it. `⋯ → Delete` removes only the view; sessions and
  terminals continue.
- Drop a session on an entry to add the session to that view.

### Inside a view

- Drag a tab over a pane: five drop zones (left, right, top, bottom, center) show a highlight.
  A side zone makes a new pane. The center moves the tab into the pane.
- Drag a tab to the tab row of a different pane, or reorder it in the same row.
- Drag the gap between panes to resize. Double-click the gap to make the panes equal.
- When the last tab leaves a pane, the pane closes and its neighbors take the space.
- The focused pane has an accent ring. The view toolbar acts on the session of the focused pane.
- A tab from a session shows a colored chip with the session name, for example
  `[gait-score] Claude`.
- The `+` of each pane opens a menu: new Claude, Opencode, or Shell for the session of the pane,
  and the tools Files, Git, Run, Docker, Env, and Flow.
- Keys: `⌘\` splits right, `⌘1`–`⌘3` focus a pane, `⌘W` closes the tab.
- A moved terminal keeps its connection and scrollback (panels stay mounted).
- On a phone, a view shows only the focused pane with its tabs. No splits.
- The browser stays a fixed strip beside the content. It is not a panel in the first version.

### After a restart

- The layout is saved after each change, with a 500 ms debounce.
- On open, the view is rebuilt: panes, sizes, tabs, and the active tab of each pane.
- A terminal that no longer exists shows **"Terminal ended"** with **Start new** and **Remove**.
  Start new keeps the panel in its position.
- A session that no longer exists shows **"Session gone"** with **Remove**.
- An offline machine shows **"Offline"**. The panel connects again when the machine returns.

## Data model

Both tables go into `schema.sqlite.ts` and `schema.pg.ts`, with one migration for each
(`drizzle-sqlite/0008_*`, `drizzle/0007_*`).

### `views`

| Column | Type | Note |
|---|---|---|
| `id` | text PK | |
| `user_id` | FK → `user`, cascade | |
| `name` | text | "View N", renamable |
| `layout` | text (JSON) | dockview shape only: groups, sizes, panel order, active panel. References panel ids. |
| `position` | integer | Sidebar order |
| `created_at`, `updated_at` | timestamp | |

### `view_panels` — the links from a view to its sessions

| Column | Type | Note |
|---|---|---|
| `id` | text PK | Same id as the panel in `layout` |
| `view_id` | FK → `views`, cascade | |
| `machine_id` | text, nullable | null = this machine |
| `session_id` | text | No FK: the session can live on a different machine |
| `kind` | text | `terminal` or `tool` |
| `terminal_id` | text, nullable | For `kind = terminal` |
| `tool` | text, nullable | `files`, `git`, `run`, `docker`, `env`, `flow` |

The layout holds only the shape. The meaning of each panel lives in `view_panels`, so the server
can query and repair the links without parsing the layout.

## How the server keeps the links correct

- **Local session deleted:** the session delete code deletes its `view_panels` rows in the same
  transaction. The view drops those panels on its next load.
- **Terminal exits or closes:** the panel row stays. "Start new" changes `terminal_id` on the
  same row, so the layout does not change.
- **Remote session gone:** the view checks on load. A 404 from the machine marks the panel
  "Session gone". An offline machine marks it "Offline" and removes nothing.
- **View deleted:** the view and its `view_panels` go (cascade). Sessions and terminals continue.
- **Reverse link:** `GET /sessions/:id` returns `views: [{ id, name }]`. The session page can show
  "In View 1", and closing a session from the sidebar warns when the session is in a view.

## API (`packages/api`)

| Method | Path | Use |
|---|---|---|
| GET | `/views` | Sidebar list, with session chips from `view_panels` |
| GET | `/views/:id` | Layout and panels |
| POST | `/views` | Create, with the first panels |
| PATCH | `/views/:id` | Name, layout, position |
| DELETE | `/views/:id` | Delete the view and its links |
| POST | `/views/:id/panels` | Add a panel (sidebar drop) |
| PATCH | `/views/:id/panels/:panelId` | Change the terminal ("Start new") |
| DELETE | `/views/:id/panels/:panelId` | Remove a panel |

All routes check `user_id`.

## UI (`packages/ui`)

- **Library:** `dockview`. It gives the drop zones, drag between groups, resize, panels that stay
  mounted, `toJSON()` / `fromJSON()`, and drops from outside the dock (`onDidDrop`,
  `showDndOverlay`) for the sidebar drag. Styled with its CSS variables to match the islands.
- **`pages/View.tsx`**, route `/views/:id`: `DockviewReact`, loads the view, saves the layout on
  change (debounced).
- **Panel components:** `terminal` with `{ machineId, sessionId, terminalId }`, and `tool` with
  `{ machineId, sessionId, tool }`.
- **`Terminal` / `useTerminal`:** an optional `machineId`. Without it, the global active machine
  is used, as now. `request()` already accepts a `machineId` override.
- **Custom tab:** icon, label, session chip, in the style of the current session tab.
- **View toolbar:** the focused session name, an "Open session" link, and `AgentLaunchButton`.
  The full session toolbar is not copied; tools open as tabs.
- **Session page:** tabs become HTML5-draggable. While a tab is dragged over the content area,
  four edge zones show. A drop calls `POST /views` with two panels and opens the view.
- **Sidebar:** `ViewsSection` at the top. Session rows are draggable with the type
  `application/x-ra-session`.

### The native browser view

The native browser view sits above all HTML, so no overlay can draw over it. During any drag,
the app makes it click-through (`togglePassthrough`), as the resize code does now.

## Out of scope for the first version

- The browser as a panel.
- One global workspace that replaces the session pages.
- Sharing a view between users.

## Testing

- API: tests for the views service — create, add and remove panels, cascade on view delete,
  cleanup on session delete, user scoping.
- UI: a check that a saved layout plus panels rebuilds the same groups, and that panels with a
  missing terminal or session get the right placeholder.
- Manual: split, move, resize, restart the app, and confirm the view returns the same.
