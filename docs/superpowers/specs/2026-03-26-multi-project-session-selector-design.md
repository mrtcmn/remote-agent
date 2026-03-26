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

The static project name in the toolbar becomes a custom dropdown button (styled like existing `ToolBtn` with a chevron icon):

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

- Implemented as a custom dropdown using an existing `ToolBtn` + a popover/menu (consistent with the toolbar's `ToolBtn` pattern, not a form `<Select>`)
- Dropdown items sourced from `session.project.childLinks`, sorted by `position`
- Each item displays the `alias` field (e.g. "frontend", "backend", "shared")
- A "Clear" option at top resets selection (tools become disabled again)
- State: `const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)`
- State resets to `null` via `useEffect` when the session `id` route param changes (prevents stale selection when navigating between sessions)

**When `session.project.isMultiProject === false`:** No change — toolbar renders the static project name as today.

**Mobile:** The project selector dropdown also appears in the mobile terminal dropdown area (Session.tsx lines 637+), using the same state and logic.

### 2. Tool Button Disabled State

When `isMultiProject && !selectedProjectId`:

- **Disabled:** Git, Run, Files, Env, Docker, Preview, VS Code — rendered with existing `disabled` prop + reduced opacity
- **Always enabled:** Claude, Shell — terminals are independent of project selection

**When user clears selection while a tool panel is open:** The view automatically switches back to `terminal` mode (same as clicking an active tool button to toggle it off). This prevents panels from rendering with `null` project data.

The active project is resolved as:

```typescript
const activeProject = selectedProjectId
  ? session?.project?.childLinks
      ?.find(l => l.childProject.id === selectedProjectId)
      ?.childProject ?? null
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

**Note:** The existing multi-project EnvEditor behavior (rendering one editor per child project) is replaced by a single EnvEditor scoped to the selected child project. This is intentional — the dropdown selector provides the per-project access pattern.

### 3. Terminal Badge for Multi-Project

Terminals created while a child project is selected get a visual indicator:

- **Tab bar:** terminal name prefixed with alias: `[frontend] Shell 1`
- **cwd:** set to the child project's `localPath` when created
- **No DB schema change** — alias is prepended to the terminal `name` field

### 4. Backend Changes

1. **Session query** — already returns `project.childLinks[].childProject` via the existing `GET /sessions/:id` endpoint. No change needed.

2. **Git routes** — read-only endpoints (`git/status`, `git/diff`, `git/file-diff`) already support `?projectId=` query param. **Write operations need updates:**

   | Route | Change needed |
   |-------|--------------|
   | `POST /sessions/:id/git/stage` | Add `projectId` body/query param, resolve child project path |
   | `POST /sessions/:id/git/unstage` | Same |
   | `POST /sessions/:id/git/commit` | Same |
   | `POST /sessions/:id/git/checkout` | Same |
   | `POST /sessions/:id/git/pull` | Same |
   | `POST /sessions/:id/git/push` | Same |
   | `POST /sessions/:id/git/fetch` | Same |
   | `GET /sessions/:id/git/branches` | Add `projectId` query param |
   | `GET /sessions/:id/git/log` | Add `projectId` query param |

   All these routes currently hardcode `session.project.localPath`. They need the same pattern used by `git/status`: resolve to child project path when `projectId` is provided.

3. **Files routes** — currently have no `projectId` support. Need to add `?projectId=` query param to:
   - `GET /sessions/:id/files` (list)
   - `GET /sessions/:id/files/content` (read)
   - `POST /sessions/:id/files/upload`
   - `DELETE /sessions/:id/files`
   - `POST /sessions/:id/files/copy`
   - `POST /sessions/:id/files/move`

   Path resolution should follow the same pattern as git routes: resolve `projectId` to child project's `localPath` and use it as the base directory.

4. **Terminal creation** — update `POST /sessions/:id/terminals` to accept optional `cwd` body param. Update `CreateTerminalInput` type in `api.ts` to include `cwd?: string`.

5. **Docker routes** — `GET /detect/:projectId` already works per-project. Other Docker operations (containers, compose) are system-wide and don't need project scoping.

### 5. Git Status Query Update

The git status polling in Session.tsx must be updated for multi-project:

```typescript
const { data: gitStatus } = useQuery({
  queryKey: ['session-git-status', id, selectedProjectId],
  queryFn: () => api.getSessionGitStatus(id!, selectedProjectId ?? undefined),
  enabled: !!id && !!activeProject,
  refetchInterval: 3000,
});
```

- `queryKey` includes `selectedProjectId` to refetch on project switch
- `enabled` requires `activeProject` to be set (disabled for multi-project with no selection)

---

## Files to Modify

### Frontend

| File | Change |
|------|--------|
| `packages/ui/src/pages/Session.tsx` | Add `selectedProjectId` state + reset effect, project selector dropdown (custom ToolBtn + popover), derive `activeProject`, update all panel props, update disabled conditions, update git status query, auto-switch to terminal view on clear, mobile selector |
| `packages/ui/src/lib/api.ts` | Add `cwd?: string` to `CreateTerminalInput`, add `projectId` param to git write operation functions and file operation functions |

### Backend

| File | Change |
|------|--------|
| `packages/api/src/routes/terminals.routes.ts` | Accept optional `cwd` body param in terminal creation |
| `packages/api/src/routes/sessions.routes.ts` | Add `projectId` support to git write routes (stage, unstage, commit, checkout, pull, push, fetch, branches, log) |
| `packages/api/src/routes/files.routes.ts` | Add `projectId` query param support to all file routes with path resolution to child project |

### No Changes Needed

- Database schema (no new tables or columns)
- Multi-project service (symlink logic unchanged)
- Docker routes (detect is already per-project, other ops are system-wide)

---

## Non-Goals

- Changing how multi-project workspaces are created or managed
- Adding new panels or views
- Changing terminal lifecycle or multiplexing
- Modifying the sidebar or navigation
