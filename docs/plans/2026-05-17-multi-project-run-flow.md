# Multi-Project Run Flow (xyflow)

Date: 2026-05-17
Owner: @mrtcmen

## Goal

A visual, node-graph editor (powered by `@xyflow/react`) for orchestrating **existing** run configs across one or more projects. Each node is a saved `runConfig` (potentially from different child projects of a multi-project workspace); edges express ordering/dependencies. The user can "Run All" / "Stop All" the flow, and the canvas reflects live status from the existing terminal/run-config infrastructure.

**Explicitly NOT in scope:** rebuilding the run mechanism. We re-use `runConfigService.start/stop/restart` and `runConfigInstances`. This plan only adds an orchestration layer on top.

## Non-goals (YAGNI)

- No new spawn adapter. Reuse `npm_script`, `custom_command`, `browser_preview`.
- No conditional / branching flows in v1 (no "if exit 0 → run B, else run C"). Edges are dependency-only.
- No DAG editor for transforming output streams between nodes.
- No persistence of execution history beyond what `runConfigInstances` already records.

---

## UX

### Entry point

In `Session.tsx`, add a new `viewMode` value: `'flow'`. New sidebar button (icon: `Workflow` from lucide-react) sits next to `run`. Only enabled when:

- the session has a project, **and**
- `project.isMultiProject === true` **or** at least one `runConfig` exists for the project.

For a single-project session the flow is still useful (express "start `db` then `api` then `web`" within one project), so we don't gate on multi-project.

### Layout

```
┌──────────────────────────────────────────────────────────┐
│  Header: [Flow name ▾]  [Run All] [Stop All] [+ Node]    │
├────────────┬─────────────────────────────────────────────┤
│  Left      │                                             │
│  Sidebar   │             xyflow canvas                   │
│  (palette) │                                             │
│            │      ┌──────┐         ┌──────┐              │
│  Project A │      │ api  │────────▶│ web  │              │
│   - dev    │      └──────┘         └──────┘              │
│   - build  │                                             │
│  Project B │      ┌──────┐                               │
│   - api    │      │ db   │                               │
│   - mig    │      └──────┘                               │
└────────────┴─────────────────────────────────────────────┘
```

- **Left palette**: list of available run configs grouped by project (for a multi-project, one group per child link; for a single project, one group). Each item is draggable onto the canvas. Re-using `RunConfigPanel`-style rows but compact, no inline start/stop.
- **Canvas**: nodes = placed run configs; edges = "B depends on A" (A must be `running` before B starts). Status reflected by:
  - dot color on the node (green = running, gray = stopped, red = exited non-zero, yellow = starting)
  - edge animation when source is running and target is queued/starting
- **Header actions**:
  - **Flow selector**: switch between saved flows, or "+ New flow"
  - **Run All**: topo-sort nodes, start roots, when each becomes `running` start its dependents (small ready delay, configurable per edge later)
  - **Stop All**: stop every node's run config in reverse topo order
  - **+ Node**: opens picker of available run configs (equivalent to dragging from palette, for keyboard users)

### Node card

```
┌─────────────────────┐
│ ● api               │  ← name + status dot
│ project-a · npm     │  ← project alias + adapter type
│ bun run dev         │  ← command preview, monospace
│ [▶] [■] [↻]        │  ← per-node start/stop/restart
└─────────────────────┘
```

Clicking the node selects it (shows xyflow's default selection ring). Double-click opens the terminal for that node's instance in the session (route to `viewMode='terminal'` + `setActiveTerminalId`).

### Edge semantics

- An edge `A → B` means: `B.start()` should be invoked only after `A` is observed in `running` status. If `A` exits before `B` starts, the flow run aborts the remaining dependents and shows an error toast (no auto-restart of the *flow* — auto-restart of an individual node still respects `runConfig.autoRestart`).
- Self-loops, multi-edges, and cycles are rejected at save time with a toast.
- A node with no incoming edge is a "root" → starts immediately on Run All.

---

## Data model

New tables (added to both `schema.pg.ts` and `schema.sqlite.ts`; mirror the existing run-config style with JSON-as-text where needed in SQLite).

### `run_flows`

```ts
export const runFlows = pgTable('run_flows', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  // Whole-flow viewport so layout survives reloads
  viewport: text('viewport'), // JSON: { x, y, zoom }
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```

A `runFlow` belongs to the *workspace* project — for multi-project workspaces that's the parent; for a single project it's that project. Child-project run-configs are still referenced freely because run_config rows know their own `projectId`.

### `run_flow_nodes`

```ts
export const runFlowNodes = pgTable('run_flow_nodes', {
  id: text('id').primaryKey(),
  flowId: text('flow_id').references(() => runFlows.id, { onDelete: 'cascade' }).notNull(),
  runConfigId: text('run_config_id').references(() => runConfigs.id, { onDelete: 'cascade' }).notNull(),
  // xyflow position
  x: integer('x').notNull().default(0),
  y: integer('y').notNull().default(0),
});
```

One run config can appear in many flows; deleting either side deletes the node.

### `run_flow_edges`

```ts
export const runFlowEdges = pgTable('run_flow_edges', {
  id: text('id').primaryKey(),
  flowId: text('flow_id').references(() => runFlows.id, { onDelete: 'cascade' }).notNull(),
  sourceNodeId: text('source_node_id').references(() => runFlowNodes.id, { onDelete: 'cascade' }).notNull(),
  targetNodeId: text('target_node_id').references(() => runFlowNodes.id, { onDelete: 'cascade' }).notNull(),
  // Optional: how to detect "source ready". v1 = wait_for_running with a delay.
  readyDelayMs: integer('ready_delay_ms').notNull().default(1000),
});
```

Relations: standard `relations(...)` blocks tying `runFlows → projects, user, nodes, edges`, `runFlowNodes → runFlows, runConfigs`, `runFlowEdges → runFlows, source/target node`.

Drizzle migration: one new SQL file `drizzle-*/00XX_run_flows.sql` for each driver. Generate via existing `bun run db:generate` script.

---

## Backend

### Service: `packages/api/src/services/run-flow/run-flow.service.ts`

```ts
class RunFlowService extends EventEmitter {
  list(projectId)                          // CRUD
  get(id)
  create({ projectId, userId, name })
  update(id, { name?, viewport?, nodes?, edges? })  // bulk replace of nodes/edges on save
  delete(id)

  // Orchestration
  async runAll(flowId, sessionId): Promise<{ runId: string }>
  async stopAll(flowId): Promise<void>
  async getStatus(flowId): Promise<NodeStatus[]>   // delegates to runConfigService per node
}
```

`runAll` algorithm:

1. Load flow with nodes + edges, fetch each `runConfig` (re-using `runConfigService.get`).
2. Validate DAG (Kahn's algorithm; reject cycle).
3. For each node, when all incoming edges are satisfied:
   - call `runConfigService.start(runConfigId, sessionId)` (already creates the terminal + instance row)
   - watch `terminalService` events for the returned `terminalId`; once `status === 'running'` (the very first stdout/event suffices) wait `edge.readyDelayMs`, then mark this edge satisfied.
4. If any started node exits before all its dependents are scheduled, emit `flow:aborted` with the offending node id and stop scheduling remaining nodes (don't kill already-running siblings — they may be intentional services).

Use existing `terminalService.on('exit', ...)` and a new `terminalService.on('ready', ...)` event if not present (otherwise poll for `status === 'running'` once after a small delay — `terminalService` already tracks status in-memory).

`stopAll`: iterate nodes, call `runConfigService.stop(runConfigId)` for each. Order doesn't matter for stop.

`getStatus`: returns `[{ nodeId, runConfigId, isRunning, activeTerminalId, exitCode? }]` reusing the enrichment logic already in `runConfigService.list`.

### Routes: `packages/api/src/routes/run-flows.routes.ts`

Following the project's Elysia + `requireAuth` + `t.Object` style:

```
GET    /run-flows/project/:projectId          → list flows
POST   /run-flows                              → create  (body: projectId, name)
GET    /run-flows/:id                          → flow + nodes + edges + per-node status
PATCH  /run-flows/:id                          → update (name, viewport, nodes[], edges[])
DELETE /run-flows/:id                          → delete
POST   /run-flows/:id/run        body: sessionId → runAll
POST   /run-flows/:id/stop                      → stopAll
GET    /run-flows/:id/status                    → status snapshot (polled by UI)
```

Register in `packages/api/src/routes/index.ts`.

Ownership: every route checks the parent project's `userId === user.id` (mirroring `runConfigs.routes.ts`).

---

## Frontend

### Dep

Add `@xyflow/react` to `packages/ui/package.json`. No other new deps.

### API client

Extend `packages/ui/src/lib/api.ts` with:

```ts
api.listRunFlows(projectId)
api.getRunFlow(id)
api.createRunFlow({ projectId, name })
api.updateRunFlow(id, patch)
api.deleteRunFlow(id)
api.runFlow(id, sessionId)
api.stopFlow(id)
api.getFlowStatus(id)
```

Types: `RunFlow`, `RunFlowNode`, `RunFlowEdge`, `FlowNodeStatus`.

### Hook: `useRunFlow(flowId)`

- `useQuery(['runFlow', id])` for the flow
- `useQuery(['runFlow', id, 'status'])` with `refetchInterval: 2000` while running, `5000` otherwise
- Mutations: `update`, `runAll`, `stopAll`
- Local state for the canvas (xyflow nodes/edges) hydrated from server; debounced auto-save (500ms) on layout changes.

### Components

```
packages/ui/src/components/run-flow/
  RunFlowView.tsx          ← top-level (header + palette + canvas)
  RunFlowCanvas.tsx        ← <ReactFlow> wrapper
  RunFlowNodeCard.tsx      ← custom node renderer
  RunFlowPalette.tsx       ← left sidebar with draggable run-config items
  RunFlowSelector.tsx      ← header dropdown to switch/create flows
  RunFlowEdge.tsx          ← optional custom edge (animated when active)
```

For multi-project workspaces, the palette groups run configs by `runConfig.project.name` and labels each group with the project's alias from `projectLinks`. For single projects, one section.

Drag-from-palette: use xyflow's `onDrop`/`onDragOver` recipe with a `dataTransfer` payload `{ runConfigId }`. On drop, optimistically add a node at the dropped position, then PATCH `/run-flows/:id` to persist.

### Session.tsx integration

- Add `'flow'` to the `ViewMode` union.
- Add a sidebar `IconButton` next to `run` using `Workflow` icon, enabled when the session has a project (always — same as `run`).
- Add a render branch:

```tsx
} else if (viewMode === 'flow' && session?.project) {
  <RunFlowView
    projectId={session.project.id}
    sessionId={session.id}
    onOpenTerminal={(terminalId) => {
      setActiveTerminalId(terminalId);
      setViewMode('terminal');
    }}
  />
}
```

---

## Execution / status flow

```
UI clicks Run All
    │
    ▼
POST /run-flows/:id/run  (sessionId)
    │
    ▼
RunFlowService.runAll
    │
    ├── topo-sort nodes
    ├── start roots ──▶ runConfigService.start ──▶ terminalService.createTerminal
    │                                                       │
    │                                                       ▼
    │                                                terminal becomes 'running'
    │                                                       │
    ├── wait readyDelayMs ◀────────────────────────────────┘
    │
    └── start next layer ... (repeat)

UI polls GET /run-flows/:id/status (every 2s during run, 5s idle)
    Server returns per-node { isRunning, activeTerminalId, exitCode }
    Canvas updates dot colors + edge animation
```

No new realtime infrastructure; reusing the same poll cadence as `RunConfigPanel`.

---

## Validation rules

- A flow node's `runConfigId` must belong to a project that is either the flow's project itself, or a child link of it (for multi-project flows). Enforced in `runFlowService.update` when persisting nodes.
- Edges must reference nodes within the same flow.
- DAG check on `update` and `runAll` (reject cycles with 400 + clear message).

---

## Phasing

**Phase 1 — read-only canvas + manual run** (one PR)

- Schema + migration + service skeleton (CRUD only, no orchestration).
- `RunFlowView` with palette, canvas, save-on-drag, single-flow per project (auto-create "Default" flow on first open).
- `Run All` = start every node in parallel (ignore edges). `Stop All` works.
- Status polling + dot colors.

This is shippable and already useful for "start my whole stack with one click."

**Phase 2 — dependency-aware execution** (follow-up PR)

- Add `runAll` topo execution with `readyDelayMs`.
- Add multi-flow management (selector, create/rename/delete flows).
- Add `flow:aborted` error toast when a parent exits before children start.

**Phase 3 — niceties (only if asked)**

- Configurable "ready condition" (regex match in stdout, port-open check) on edges.
- Edge labels / per-edge `readyDelayMs` UI.
- Persistence of last successful run for a "re-run from failed node" affordance.

---

## Files touched

Backend:

- `packages/api/src/db/schema.pg.ts` — add `runFlows`, `runFlowNodes`, `runFlowEdges` + relations
- `packages/api/src/db/schema.sqlite.ts` — same
- `packages/api/drizzle-*/00XX_run_flows.sql` — generated
- `packages/api/src/services/run-flow/{index.ts,run-flow.service.ts}` — new
- `packages/api/src/routes/run-flows.routes.ts` — new
- `packages/api/src/routes/index.ts` — `.use(runFlowRoutes)`

Frontend:

- `packages/ui/package.json` — add `@xyflow/react`
- `packages/ui/src/lib/api.ts` — RunFlow CRUD + run/stop/status
- `packages/ui/src/hooks/useRunFlow.ts` — new
- `packages/ui/src/components/run-flow/*` — new (5 files)
- `packages/ui/src/pages/Session.tsx` — `viewMode='flow'` + sidebar button + render branch

---

## Open questions to resolve at implementation time

- Should the flow live on the parent multi-project only, or also on a single project? **Decision: both.** Single-project flows are useful for `db → api → web` within one repo.
- Should running flow state survive page reloads? **Yes, implicitly** — each node's `runConfigInstance` is already persisted; the canvas just polls status.
- Should we auto-create a "Default" flow per project? **Yes** for phase 1 to skip the empty state, then phase 2 introduces multi-flow.
