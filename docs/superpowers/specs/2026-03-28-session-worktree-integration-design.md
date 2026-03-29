# Session-Worktree Integration Design

**Date:** 2026-03-28
**Status:** Approved

## Summary

Connect sessions to git worktrees so users can seamlessly context-switch between tasks. Each project can have one "local" session (main repo checkout) and N worktree sessions, each isolated on its own branch. The sidebar shows only active sessions grouped by project, with distinct icons for local (GitBranch) and worktree (Layers) sessions.

## Motivation

Today, a project has one `localPath` with one checked-out branch. Two sessions on the same project step on each other. Users who want to pivot to a different task must stash/commit, switch branches, and hope nothing conflicts. Worktrees give each session its own isolated directory and branch — no conflicts, instant context switching.

## Data Model

### New table: `worktrees`

```sql
CREATE TABLE worktrees (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id TEXT NOT NULL REFERENCES "user"(id),
  name TEXT NOT NULL,
  branch TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

| Column | Description |
|--------|-------------|
| `id` | nanoid primary key |
| `projectId` | Parent project (the main repo) |
| `userId` | Owner |
| `name` | User-given label, e.g. "oxc plugins experiment" |
| `branch` | Branch checked out in this worktree |
| `path` | Absolute filesystem path to worktree directory |

### Modified table: `claude_sessions`

Add one nullable column:

```sql
ALTER TABLE claude_sessions ADD COLUMN worktree_id TEXT REFERENCES worktrees(id) ON DELETE SET NULL;
```

### Session type resolution

- `worktreeId = null` + `projectId != null` → **local** session (GitBranch icon)
- `worktreeId != null` → **worktree** session (Layers icon)
- Both null → unbound session (not shown in new sidebar)

### Path resolution

All git/file/terminal operations resolve the working directory as:

```
if (session.worktreeId) → worktree.path
else if (session.projectId) → project.localPath
```

This replaces the current logic that always uses `project.localPath`.

## Worktree Service

New service: `packages/api/src/services/git/worktree.service.ts`

### Filesystem layout

Worktrees are stored adjacent to the project directory:

```
<project.localPath>/../.worktrees/<project-name>/<worktree-id>/
```

This keeps them outside the main repo but discoverable.

### Operations

**`create(projectId, userId, branch, name, createBranch?)`**
1. Validate project exists and belongs to user
2. Generate worktree ID (nanoid)
3. Compute path: `<project.localPath>/../.worktrees/<projectName>/<worktreeId>/`
4. Run `git worktree add <path> <branch>` (or `git worktree add -b <branch> <path>` if creating new branch)
5. Insert row into `worktrees` table
6. Return worktree record

**`remove(worktreeId, userId)`**
1. Validate worktree exists and belongs to user
2. Terminate any active sessions bound to this worktree
3. Run `git worktree remove <path> --force`
4. Delete row from `worktrees` table

**`list(projectId)`**
- Return all worktrees for a project from DB

**`getById(worktreeId)`**
- Return single worktree record

## API Routes

### Worktree routes (`/projects/:id/worktrees`)

**`POST /projects/:id/worktrees`** — Create worktree + session
- Body: `{ branch: string, name: string, createBranch?: boolean }`
- Creates worktree on disk via WorktreeService
- Creates a session with `projectId` and `worktreeId` set
- Returns `{ worktree, session }`

**`GET /projects/:id/worktrees`** — List worktrees
- Returns all worktrees for the project

**`DELETE /worktrees/:id`** — Remove worktree
- Terminates bound sessions
- Removes from disk and DB

### Modified session routes

**Path resolution in existing git/file routes:**

All routes under `/sessions/:id/git/*`, `/sessions/:id/files/*`, and terminal creation must resolve the working directory using the new path resolution logic:

```typescript
function resolveSessionPath(session): string {
  if (session.worktreeId && session.worktree) {
    return session.worktree.path
  }
  if (session.projectId && session.project) {
    return session.project.localPath
  }
  throw new Error('Session has no project or worktree')
}
```

This is a single extraction point — currently the path is resolved inline in each route using `session.project.localPath`. Replace all those references.

### Modified session creation

`POST /sessions` already accepts `projectId`. Add optional `worktreeId`:

```typescript
body: {
  projectId?: string,
  worktreeId?: string,  // new
}
```

If `worktreeId` is provided, validate it belongs to the same project.

## Sidebar UI

### Structure

Replace the current session/project list with a grouped view:

```
[Project Name] (count) [+] [▼]
  ├─ 🔀 local          main        +23 -0
  ├─ 📑 docking..       feat/dock   +372 -168
  └─ 📑 oxc plugins     feat/oxc    +2043 -13

[Another Project] (count) [+] [▼]
  └─ 🔀 local          dev         +88 -12
```

- **Only projects with active sessions are shown**
- **Only active sessions shown** under each project
- Each session row: icon (GitBranch or Layers), name, branch, diff stats
- Clicking a row navigates to the session view (existing mechanism)
- `+` button opens the "New Session" dialog

### Session Row Component

Reuse the design from the mockup:
- `GitBranch` icon for local sessions
- `Layers` icon for worktree sessions
- Name (truncated), branch (mono, muted), diff stats (green/red)
- Active indicator (left bar) for currently viewed session

### Workspace Group Component

- Collapsible project header with initial badge (colored), name, session count
- `+` button on hover for creating new sessions/worktrees
- Chevron for expand/collapse

## New Session Dialog

Triggered by `+` button on a project group. Offers two options:

### Option 1: Start Local Session
- No additional input needed
- Creates session with `projectId` set, `worktreeId = null`
- Only available if no active local session exists (one local session at a time)

### Option 2: New Worktree Session
- **Branch input:** Autocomplete from `git branch -a`, or type new branch name
- **Name input:** User-given label for the worktree (defaults to branch name)
- **Create branch toggle:** If branch doesn't exist, offer to create from current HEAD
- Creates worktree on disk + session bound to it

## Diff Stats

Each sidebar row shows `+added / -removed` stats. Source:

- Run `git diff --stat` on the session's resolved path
- Shows uncommitted changes (working directory vs HEAD)
- Polled or refreshed on session switch / file save events
- Exact refresh mechanism to be determined during implementation

## Edge Cases

### Worktree with no active session
- Worktree persists on disk but does not appear in sidebar
- User can see and manage orphan worktrees through a separate "Manage Worktrees" UI (future, not in this spec)
- For now: `+` dialog shows existing worktrees without active sessions as reconnectable options

### Deleting a project with worktrees
- Cascade: remove all worktrees from disk + DB
- Terminate all sessions bound to the project or its worktrees

### Branch conflicts
- Two worktrees cannot check out the same branch (git enforces this)
- If user tries, show error from git

### Local session branch changes
- User can `git checkout` in a local session, changing the branch
- Sidebar branch display should update (polled or event-driven)

## Implementation Scope

### In scope
- `worktrees` table + migration
- `worktreeId` column on `claude_sessions` + migration
- `WorktreeService` (create, remove, list)
- API routes for worktree CRUD
- Path resolution refactor in session routes
- New sidebar component (grouped by project, session rows)
- New session dialog (local vs worktree)
- Diff stats display (basic implementation)

### Out of scope (future work)
- Worktree management UI (view/delete orphan worktrees outside sidebar)
- Auto-cleanup of stale worktrees
- Worktree-to-worktree merge/rebase tools
- Branch protection rules for worktrees
