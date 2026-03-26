# Multi-Project Session Selector

**Date:** 2026-03-26
**Status:** Approved

## Problem

When a session is linked to a multi-project workspace (`isMultiProject: true`), the toolbar tools (Git, Run, Files, Env, Docker, Preview, VS Code) need to know which child project to operate on. Currently there is no UI for selecting which child project is "active" within a multi-project session.

## Solution

Add a **dropdown project selector** in the toolbar for multi-project sessions. Tool buttons are always visible but disabled until a child project is selected.

---

## Design

### 1. Toolbar Project Selector

**When `session.project.isMultiProject === true`:**

The static project name in the toolbar becomes a `<Select>` dropdown:

```
[←] [▾ Select project] | [Claude] | [Shell] [Git] | [Run] [Files] | [Env] [Docker] [Preview] | [VS Code]
                                                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                                     disabled (opacity-50, pointer-events-none)
```

After selecting a child project (e.g. "frontend"):

```
[←] [▾ frontend] | [Claude] | [Shell] [Git] | [Run] [Files] | [Env] [Docker] [Preview] | [VS Code]
                                                all tools enabled, scoped to "frontend" child project
```

- Dropdown items sourced from `session.project.childLinks`, sorted by `position`
- Each item displays the `alias` field (e.g. "frontend", "backend", "shared")
- A "None" / clear option at top resets selection (tools become disabled again)
- State: `const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)`

**When `session.project.isMultiProject === false`:** No change — toolbar renders the static project name as today.

### 2. Tool Button Disabled State

When `isMultiProject && !selectedProjectId`:

- **Disabled:** Git, Run, Files, Env, Docker, Preview, VS Code — rendered with existing `disabled` prop + reduced opacity
- **Always enabled:** Claude, Shell — terminals are independent of project selection

The active project is resolved as:

```typescript
const activeProject = selectedProjectId
  ? session.project.childLinks
      .find(l => l.childProject.id === selectedProjectId)
      ?.childProject
  : (!session?.project?.isMultiProject ? session?.project : null);
```

All panels receive `activeProject` instead of `session.project`:

| Panel | Prop change |
|-------|------------|
| GitPanel | `project={activeProject}` |
| EnvEditor | `projectId={activeProject.id}` |
| DockerPanel | `projectId={activeProject.id}` |
| RunConfigPanel | `projectId={activeProject.id}` |
| FileExplorer | `project={activeProject}` |
| VS Code | `openEditorMutation.mutate(activeProject.localPath)` |

### 3. Terminal Badge for Multi-Project

Terminals created while a child project is selected get a visual indicator:

- **Tab bar:** terminal name prefixed with alias: `[frontend] Shell 1`
- **cwd:** set to the child project's `localPath` when created
- **No DB schema change** — alias is prepended to the terminal `name` field

### 4. Backend Changes

Minimal changes needed:

1. **Session query** — already returns `project.childLinks[].childProject` via the existing `GET /sessions/:id` endpoint
2. **Git/Files/Env routes** — already support `?projectId=` query param for child project resolution
3. **Terminal creation** — update `POST /sessions/:id/terminals` to accept optional `cwd` parameter so new terminals start in the selected child project's directory

---

## Files to Modify

### Frontend

| File | Change |
|------|--------|
| `packages/ui/src/pages/Session.tsx` | Add `selectedProjectId` state, project selector dropdown, derive `activeProject`, update all panel props, update disabled conditions |
| `packages/ui/src/pages/Session.tsx` | Terminal creation mutation passes cwd + name prefix when child project selected |

### Backend

| File | Change |
|------|--------|
| `packages/api/src/routes/terminals.routes.ts` | Accept optional `cwd` body param in terminal creation |

### No Changes Needed

- Database schema (no new tables or columns)
- Multi-project service (symlink logic unchanged)
- Git/Files/Docker/Env routes (already support projectId param)
- API client (`packages/ui/src/lib/api.ts`) — may need minor type updates only

---

## Non-Goals

- Changing how multi-project workspaces are created or managed
- Adding new panels or views
- Changing terminal lifecycle or multiplexing
- Modifying the sidebar or navigation
