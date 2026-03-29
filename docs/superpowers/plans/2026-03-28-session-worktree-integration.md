# Session-Worktree Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow sessions to be bound to git worktrees so users can work on multiple branches simultaneously within the same project.

**Architecture:** New `worktrees` table + `worktreeId` FK on `claude_sessions`. A `WorktreeService` wraps `git worktree` CLI commands. The sidebar is updated to show sessions grouped by project with distinct icons for local vs worktree sessions. A new dialog lets users create worktree sessions (branch picker + name input) or start local sessions.

**Tech Stack:** Drizzle ORM (PostgreSQL), Elysia.js routes, React + TanStack Query + motion/react frontend, Bun shell for git CLI.

---

## File Structure

### New files
- `packages/api/src/services/git/worktree.service.ts` — Worktree CRUD (create/remove/list) wrapping `git worktree` CLI
- `packages/api/src/routes/worktrees.routes.ts` — API routes for worktree operations

### Modified files
- `packages/api/src/db/schema.ts` — Add `worktrees` table, add `worktreeId` to `claudeSessions`, add relations
- `packages/api/src/routes/index.ts` — Register worktree routes
- `packages/api/src/routes/sessions.routes.ts` — Update `resolveTargetPath` to check worktree, update sidebar endpoint, update session creation
- `packages/ui/src/lib/api.ts` — Add worktree types and API methods, update `SidebarSession` type
- `packages/ui/src/components/AppSidebar.tsx` — Update `SessionRow` to show git/worktree icons, update `ProjectGroup` with `+` button
- `packages/ui/src/components/NewSessionModal.tsx` — Redesign as worktree-aware dialog with branch picker

---

### Task 1: Database Schema — `worktrees` table and `worktreeId` on sessions

**Files:**
- Modify: `packages/api/src/db/schema.ts:117-127` (claudeSessions) and add new table + relations

- [ ] **Step 1: Add `worktrees` table to schema**

In `packages/api/src/db/schema.ts`, add the `worktrees` table after the `projectLinks` table (after line 115):

```typescript
// Git worktrees (isolated branch checkouts)
export const worktrees = pgTable('worktrees', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  branch: text('branch').notNull(),
  path: text('path').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

- [ ] **Step 2: Add `worktreeId` column to `claudeSessions`**

In the `claudeSessions` table definition, add after `projectId`:

```typescript
  worktreeId: text('worktree_id').references(() => worktrees.id, { onDelete: 'set null' }),
```

- [ ] **Step 3: Add relations for `worktrees`**

After the existing `projectLinksRelations`, add:

```typescript
export const worktreesRelations = relations(worktrees, ({ one, many }) => ({
  project: one(projects, {
    fields: [worktrees.projectId],
    references: [projects.id],
  }),
  user: one(user, {
    fields: [worktrees.userId],
    references: [user.id],
  }),
  sessions: many(claudeSessions),
}));
```

- [ ] **Step 4: Update `claudeSessionsRelations` to include worktree**

Add to the existing `claudeSessionsRelations`:

```typescript
  worktree: one(worktrees, {
    fields: [claudeSessions.worktreeId],
    references: [worktrees.id],
  }),
```

- [ ] **Step 5: Update `projectsRelations` to include worktrees**

Add to the existing `projectsRelations`:

```typescript
  worktrees: many(worktrees),
```

- [ ] **Step 6: Add type exports**

At the bottom of schema.ts with the other type exports, add:

```typescript
export type Worktree = typeof worktrees.$inferSelect;
export type NewWorktree = typeof worktrees.$inferInsert;
```

- [ ] **Step 7: Generate and apply migration**

Run:
```bash
cd packages/api && npx drizzle-kit generate
```

Expected: New migration file created in `packages/api/drizzle/` with CREATE TABLE worktrees and ALTER TABLE claude_sessions ADD COLUMN worktree_id.

Then apply:
```bash
cd packages/api && npx drizzle-kit push
```

Expected: Migration applied successfully.

- [ ] **Step 8: Verify TypeScript compiles**

Run:
```bash
cd packages/api && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add packages/api/src/db/schema.ts packages/api/drizzle/
git commit -m "feat: add worktrees table and worktreeId to sessions schema"
```

---

### Task 2: WorktreeService — git worktree CLI wrapper

**Files:**
- Create: `packages/api/src/services/git/worktree.service.ts`
- Modify: `packages/api/src/services/git/index.ts` (if it exists, otherwise check how gitService is exported)

- [ ] **Step 1: Check how git service is exported**

Run:
```bash
ls packages/api/src/services/git/
```

If there's an `index.ts`, read it to see the export pattern.

- [ ] **Step 2: Create WorktreeService**

Create `packages/api/src/services/git/worktree.service.ts`:

```typescript
import { $ } from 'bun';
import { join, dirname, basename } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { db, worktrees, claudeSessions, projects } from '../../db';

export class WorktreeService {
  /**
   * Compute the filesystem path for a new worktree.
   * Layout: <project.localPath>/../.worktrees/<projectDirName>/<worktreeId>/
   */
  private worktreePath(projectLocalPath: string, worktreeId: string): string {
    const parentDir = dirname(projectLocalPath);
    const projectDirName = basename(projectLocalPath);
    return join(parentDir, '.worktrees', projectDirName, worktreeId);
  }

  async create(opts: {
    projectId: string;
    userId: string;
    branch: string;
    name: string;
    createBranch?: boolean;
  }): Promise<typeof worktrees.$inferSelect> {
    // Validate project
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, opts.projectId), eq(projects.userId, opts.userId)),
    });
    if (!project) throw new Error('Project not found');
    if (project.isMultiProject) throw new Error('Cannot create worktree on multi-project workspace');

    const id = nanoid();
    const wtPath = this.worktreePath(project.localPath, id);

    // Ensure parent directory exists
    await mkdir(dirname(wtPath), { recursive: true });

    // Create git worktree
    if (opts.createBranch) {
      const result = await $`git worktree add -b ${opts.branch} ${wtPath}`.cwd(project.localPath).nothrow().quiet();
      if (result.exitCode !== 0) {
        throw new Error(`Failed to create worktree: ${result.stderr.toString()}`);
      }
    } else {
      const result = await $`git worktree add ${wtPath} ${opts.branch}`.cwd(project.localPath).nothrow().quiet();
      if (result.exitCode !== 0) {
        throw new Error(`Failed to create worktree: ${result.stderr.toString()}`);
      }
    }

    // Insert DB record
    await db.insert(worktrees).values({
      id,
      projectId: opts.projectId,
      userId: opts.userId,
      name: opts.name,
      branch: opts.branch,
      path: wtPath,
    });

    const worktree = await db.query.worktrees.findFirst({
      where: eq(worktrees.id, id),
    });

    return worktree!;
  }

  async remove(worktreeId: string, userId: string): Promise<void> {
    const worktree = await db.query.worktrees.findFirst({
      where: and(eq(worktrees.id, worktreeId), eq(worktrees.userId, userId)),
      with: { project: true },
    });
    if (!worktree) throw new Error('Worktree not found');

    // Terminate any sessions bound to this worktree
    await db.update(claudeSessions)
      .set({ worktreeId: null })
      .where(eq(claudeSessions.worktreeId, worktreeId));

    // Remove git worktree from disk
    const project = (worktree as any).project;
    if (project) {
      const result = await $`git worktree remove ${worktree.path} --force`
        .cwd(project.localPath).nothrow().quiet();
      if (result.exitCode !== 0) {
        // Try to force remove if normal remove fails
        await $`rm -rf ${worktree.path}`.nothrow().quiet();
        await $`git worktree prune`.cwd(project.localPath).nothrow().quiet();
      }
    }

    // Delete DB record
    await db.delete(worktrees).where(eq(worktrees.id, worktreeId));
  }

  async list(projectId: string): Promise<(typeof worktrees.$inferSelect)[]> {
    return db.query.worktrees.findMany({
      where: eq(worktrees.projectId, projectId),
      orderBy: (w, { desc }) => [desc(w.createdAt)],
    });
  }

  async getById(worktreeId: string): Promise<typeof worktrees.$inferSelect | undefined> {
    return db.query.worktrees.findFirst({
      where: eq(worktrees.id, worktreeId),
    });
  }
}

export const worktreeService = new WorktreeService();
```

- [ ] **Step 3: Export from git service index**

Check if `packages/api/src/services/git/index.ts` exists. If it does, add:

```typescript
export { worktreeService } from './worktree.service';
```

If it doesn't exist and `gitService` is imported directly from `git.service.ts`, just ensure `worktree.service.ts` is importable from its path.

- [ ] **Step 4: Verify TypeScript compiles**

Run:
```bash
cd packages/api && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/git/worktree.service.ts
git commit -m "feat: add WorktreeService for git worktree lifecycle management"
```

---

### Task 3: API Routes — Worktree CRUD + session path resolution

**Files:**
- Create: `packages/api/src/routes/worktrees.routes.ts`
- Modify: `packages/api/src/routes/index.ts`
- Modify: `packages/api/src/routes/sessions.routes.ts`

- [ ] **Step 1: Create worktree routes**

Create `packages/api/src/routes/worktrees.routes.ts`:

```typescript
import { Elysia, t } from 'elysia';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, projects, worktrees, claudeSessions } from '../db';
import { worktreeService } from '../services/git/worktree.service';
import { requireAuth } from '../auth/middleware';

export const worktreeRoutes = new Elysia({ prefix: '/worktrees' })
  .use(requireAuth)

  // List worktrees for a project
  .get('/project/:projectId', async ({ user, params, set }) => {
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, params.projectId), eq(projects.userId, user!.id)),
    });
    if (!project) {
      set.status = 404;
      return { error: 'Project not found' };
    }
    return worktreeService.list(params.projectId);
  }, {
    params: t.Object({ projectId: t.String() }),
  })

  // Create worktree + session
  .post('/', async ({ user, body, set }) => {
    try {
      // Create the worktree on disk + DB
      const worktree = await worktreeService.create({
        projectId: body.projectId,
        userId: user!.id,
        branch: body.branch,
        name: body.name,
        createBranch: body.createBranch,
      });

      // Create a session bound to this worktree
      const sessionId = nanoid();
      await db.insert(claudeSessions).values({
        id: sessionId,
        userId: user!.id,
        projectId: body.projectId,
        worktreeId: worktree.id,
        status: 'active',
        createdAt: new Date(),
        lastActiveAt: new Date(),
      });

      const session = await db.query.claudeSessions.findFirst({
        where: eq(claudeSessions.id, sessionId),
        with: { project: true, worktree: true },
      });

      return { worktree, session };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    body: t.Object({
      projectId: t.String(),
      branch: t.String(),
      name: t.String(),
      createBranch: t.Optional(t.Boolean()),
    }),
  })

  // Delete worktree
  .delete('/:id', async ({ user, params, set }) => {
    try {
      await worktreeService.remove(params.id, user!.id);
      return { success: true };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({ id: t.String() }),
  });
```

- [ ] **Step 2: Register worktree routes in index**

In `packages/api/src/routes/index.ts`, add:

```typescript
import { worktreeRoutes } from './worktrees.routes';
```

And register it alongside the other routes (after `.use(sessionRoutes)`):

```typescript
  .use(worktreeRoutes)
```

- [ ] **Step 3: Update `resolveTargetPath` in sessions.routes.ts to support worktrees**

Replace the existing `resolveTargetPath` function at the top of `packages/api/src/routes/sessions.routes.ts`:

```typescript
/** Resolve target path for git operations, supporting worktrees and multi-project. */
async function resolveTargetPath(
  session: {
    project?: { id: string; localPath: string; isMultiProject: boolean } | null;
    worktree?: { path: string } | null;
    worktreeId?: string | null;
  },
  projectId: string | undefined
): Promise<string | null> {
  // Worktree takes priority
  if (session.worktreeId && session.worktree) {
    return session.worktree.path;
  }

  const project = session.project;
  if (!project) return null;
  if (!projectId || !project.isMultiProject) return project.localPath;

  const link = await db.query.projectLinks.findFirst({
    where: and(
      eq(projectLinks.parentProjectId, project.id),
      eq(projectLinks.childProjectId, projectId)
    ),
    with: { childProject: true },
  });

  return link && (link as any).childProject
    ? (link as any).childProject.localPath
    : null;
}
```

- [ ] **Step 4: Update session queries to include worktree relation**

In `sessions.routes.ts`, every route that fetches a session and then calls `resolveTargetPath` needs to include `worktree` in the `with` clause. Update all session queries that currently have `with: { project: true }` to:

```typescript
with: { project: true, worktree: true },
```

This applies to the routes for: git/status, git/diff, git/file-diff, git/stage, git/unstage, git/commit, git/checkout, git/pull, git/push, git/fetch, git/log, git/branches.

For the compact routes (stage, unstage, commit, checkout, pull, push, fetch, log, branches) that use `resolveTargetPath`, update each session fetch. For example, the stage route:

```typescript
  .post('/:id/git/stage', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true, worktree: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    const targetPath = await resolveTargetPath(session, body.projectId);
    if (!targetPath) { set.status = 404; return { error: 'Linked project not found' }; }
    // ... rest unchanged
```

For the verbose routes (git/status, git/diff, git/file-diff) that do inline path resolution instead of calling `resolveTargetPath`, refactor them to also use `resolveTargetPath`. The session fetch already gets `project`, add `worktree`:

For git/status (line ~133-185):
- Change `with: { project: true }` to `with: { project: true, worktree: true }`
- Replace the entire path resolution block with:
```typescript
    // Resolve working path (worktree > multi-project child > project)
    if (session.worktreeId && session.worktree) {
      targetPath = session.worktree.path;
    } else if (!session.project) {
      return { branch: '', ahead: 0, behind: 0, staged: [], modified: [], untracked: [] };
    } else if (query.projectId && session.project.isMultiProject) {
      // existing multi-project resolution...
    } else if (!query.projectId && session.project.isMultiProject) {
      return { branch: '', ahead: 0, behind: 0, staged: [], modified: [], untracked: [] };
    } else {
      targetPath = session.project.localPath;
    }
```

Apply the same pattern to git/diff and git/file-diff routes.

- [ ] **Step 5: Update session creation to accept worktreeId**

In the `POST /` route for creating sessions (line ~92), update the body schema:

```typescript
  body: t.Object({
    projectId: t.Optional(t.String()),
    worktreeId: t.Optional(t.String()),
  }),
```

And in the handler, add `worktreeId` to the insert:

```typescript
    await db.insert(claudeSessions).values({
      id: sessionId,
      userId: user!.id,
      projectId: body.projectId || null,
      worktreeId: body.worktreeId || null,
      status: 'active',
      createdAt: new Date(),
      lastActiveAt: new Date(),
    });
```

- [ ] **Step 6: Update sidebar endpoint to include worktree data**

In the `GET /sessions/sidebar` route, update the session data building to include worktree info. After line ~536 where `sessionDataMap` entries are built:

First, load all worktrees for the user's projects:

```typescript
    // Load worktrees
    const allWorktrees = await db.query.worktrees.findMany({
      where: eq(worktrees.userId, user!.id),
    });
    const worktreeMap = new Map(allWorktrees.map(w => [w.id, w]));
```

Add `worktreeId`, `worktreeName`, and `sessionType` to the session data map entries:

```typescript
      const worktree = session.worktreeId ? worktreeMap.get(session.worktreeId) : null;

      sessionDataMap.set(session.id, {
        id: session.id,
        status: session.status,
        liveStatus,
        branchName,
        diffStats,
        commentCount: commentCounts[session.id] || 0,
        worktreeId: session.worktreeId || null,
        worktreeName: worktree?.name || null,
        sessionType: session.worktreeId ? 'worktree' : 'git',
      });
```

For worktree sessions, resolve git stats from the worktree path instead of the project path. Update the git stats block (~line 562):

```typescript
      if (liveStatus === 'active' && session.projectId) {
        const project = userProjects.find(p => p.id === session.projectId);
        if (project && !project.isMultiProject) {
          // Determine the path for git ops
          const gitPath = worktree ? worktree.path : project.localPath;
          try {
            const [status, stats] = await Promise.all([
              gitService.status(gitPath),
              gitService.diffStats(gitPath),
            ]);
            branchName = status.branch;
            if (stats.additions > 0 || stats.deletions > 0) {
              diffStats = stats;
            }
          } catch {
            // Git operations may fail
          }
        }
      }
```

- [ ] **Step 7: Update `GET /sessions/:id` to include worktree**

In the single session fetch route, add worktree to the with clause:

```typescript
      with: {
        project: {
          with: {
            childLinks: {
              with: { childProject: true },
            },
          },
        },
        worktree: true,
      },
```

- [ ] **Step 8: Verify TypeScript compiles**

Run:
```bash
cd packages/api && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add packages/api/src/routes/worktrees.routes.ts packages/api/src/routes/index.ts packages/api/src/routes/sessions.routes.ts
git commit -m "feat: add worktree API routes and update session path resolution"
```

---

### Task 4: Frontend Types and API Client

**Files:**
- Modify: `packages/ui/src/lib/api.ts`

- [ ] **Step 1: Add `Worktree` type**

After the `ProjectLink` interface in `api.ts`, add:

```typescript
export interface Worktree {
  id: string;
  projectId: string;
  userId: string;
  name: string;
  branch: string;
  path: string;
  createdAt: string;
}
```

- [ ] **Step 2: Update `SidebarSession` type**

Update the existing `SidebarSession` interface to include worktree fields:

```typescript
export interface SidebarSession {
  id: string;
  status: string;
  liveStatus: string;
  branchName: string;
  diffStats: { additions: number; deletions: number } | null;
  commentCount: number;
  worktreeId: string | null;
  worktreeName: string | null;
  sessionType: 'git' | 'worktree';
}
```

- [ ] **Step 3: Update `Session` type**

Add to the existing `Session` interface:

```typescript
  worktreeId?: string;
  worktree?: Worktree;
```

- [ ] **Step 4: Add worktree API methods**

In the `api` object, add after the sidebar section:

```typescript
  // ─── Worktrees ──────────────────────────────────────────────────────────

  getWorktrees: (projectId: string) =>
    request<Worktree[]>(`/worktrees/project/${projectId}`),
  createWorktree: (data: { projectId: string; branch: string; name: string; createBranch?: boolean }) =>
    request<{ worktree: Worktree; session: Session }>('/worktrees', { method: 'POST', body: JSON.stringify(data) }),
  deleteWorktree: (id: string) =>
    request<{ success: boolean }>(`/worktrees/${id}`, { method: 'DELETE' }),
```

- [ ] **Step 5: Update `createSession` to accept `worktreeId`**

```typescript
  createSession: (projectId?: string, worktreeId?: string) =>
    request<Session>('/sessions', { method: 'POST', body: JSON.stringify({ projectId, worktreeId }) }),
```

- [ ] **Step 6: Verify TypeScript compiles**

Run:
```bash
cd packages/ui && npx tsc --noEmit
```

Expected: No errors (there may be some unrelated existing warnings — focus on new errors only).

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/lib/api.ts
git commit -m "feat: add worktree types and API methods to frontend"
```

---

### Task 5: Sidebar UI — Session icons and `+` button

**Files:**
- Modify: `packages/ui/src/components/AppSidebar.tsx`

- [ ] **Step 1: Add GitBranch import**

Update the lucide-react imports at the top of AppSidebar.tsx to include `GitBranch`:

```typescript
import {
  Layers,
  Plus,
  ChevronDown,
  LayoutGrid,
  ListTodo,
  Settings,
  Sparkles,
  Plug,
  FolderGit2,
  Loader2,
  X,
  GripVertical,
  GitBranch,
} from 'lucide-react';
```

- [ ] **Step 2: Update `SessionRow` to show type-specific icons**

Replace the status dot in `SessionRow` with a type-aware icon + status dot. Replace the entire `SessionRow` function:

```typescript
function SessionRow({
  session,
  isSelected,
  onSelect,
}: {
  session: SidebarSession;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const effectiveStatus = session.liveStatus || session.status;
  const dotClass = statusDotClass[effectiveStatus] || 'bg-gray-500';
  const Icon = session.sessionType === 'worktree' ? Layers : GitBranch;

  return (
    <motion.button
      layout
      onClick={onSelect}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.12 }}
      className={cn(
        'group/session w-full flex items-start gap-2 pl-3 pr-2 py-1.5 rounded-md text-left relative',
        isSelected
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
      )}
    >
      <AnimatePresence>
        {isSelected && (
          <motion.span
            layoutId="session-indicator"
            className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-foreground/30"
            initial={{ opacity: 0, scaleY: 0.5 }}
            animate={{ opacity: 1, scaleY: 1 }}
            exit={{ opacity: 0, scaleY: 0.5 }}
            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
          />
        )}
      </AnimatePresence>

      <div className="relative mt-0.5 shrink-0">
        <Icon
          className={cn(
            'transition-colors',
            session.sessionType === 'worktree' ? 'size-2.5' : 'size-3',
            isSelected ? 'text-foreground/60' : 'text-muted-foreground/40 group-hover/session:text-muted-foreground'
          )}
        />
        <span className={cn('absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full', dotClass)} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1.5">
          <span className="text-xs font-medium truncate leading-snug">
            {session.worktreeName || session.branchName || session.id.slice(0, 8)}
          </span>
          {session.diffStats && (
            <DiffStat additions={session.diffStats.additions} deletions={session.diffStats.deletions} />
          )}
        </div>
        <span className="block text-[10px] leading-snug font-mono truncate text-muted-foreground/50 mt-0.5">
          {session.branchName || session.id.slice(0, 8)}
        </span>
      </div>
    </motion.button>
  );
}
```

- [ ] **Step 3: Add `+` button to `ProjectGroup` header**

Update the `ProjectGroup` component to accept an `onAdd` callback and render a `+` button. Add to the props:

```typescript
  onAdd: () => void;
```

In the project header div, add a `+` button after the session count and before the chevron:

```typescript
        <button
          className="opacity-0 group-hover/ws:opacity-100 transition-opacity p-0.5 rounded hover:bg-border text-muted-foreground/50 hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
        >
          <Plus className="size-2.5" />
        </button>
```

- [ ] **Step 4: Update `AppSidebar` to pass `onAdd` and track target project**

Add state for which project the new session modal targets:

```typescript
  const [newSessionProjectId, setNewSessionProjectId] = useState<string | null>(null);
```

When the `+` button on a ProjectGroup is clicked:

```typescript
  const handleProjectAdd = (projectId: string) => {
    setNewSessionProjectId(projectId);
    setNewSessionModalOpen(true);
  };
```

Pass it to `ProjectGroup`:

```typescript
  <ProjectGroup
    project={project}
    activeSessionId={activeSessionId}
    onSelectSession={handleSelectSession}
    onAdd={() => handleProjectAdd(project.id)}
    onDragStart={(e) => handleProjectDragStart(e, project.id)}
    onDragOver={(e) => handleProjectDragOver(e, project.id)}
    onDrop={(e) => handleProjectDrop(e, project.id)}
    isDragOver={dragOverProjectId === project.id}
  />
```

Update the NewSessionModal usage to pass the project context:

```typescript
  <NewSessionModal
    open={newSessionModalOpen}
    onClose={() => {
      setNewSessionModalOpen(false);
      setNewSessionProjectId(null);
    }}
    preselectedProjectId={newSessionProjectId}
  />
```

- [ ] **Step 5: Verify TypeScript compiles**

Run:
```bash
cd packages/ui && npx tsc --noEmit
```

Expected: Errors related to `NewSessionModal` not accepting `preselectedProjectId` yet — that's expected, fixed in next task.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/AppSidebar.tsx
git commit -m "feat: update sidebar with git/worktree icons and per-project add button"
```

---

### Task 6: New Session Modal — Worktree-aware dialog

**Files:**
- Modify: `packages/ui/src/components/NewSessionModal.tsx`

- [ ] **Step 1: Rewrite NewSessionModal with worktree support**

Replace the entire contents of `NewSessionModal.tsx`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderGit2, GitBranch, Layers, Loader2, X } from 'lucide-react';
import { api, type Project } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

type SessionMode = 'local' | 'worktree';

interface NewSessionModalProps {
  open: boolean;
  onClose: () => void;
  preselectedProjectId?: string | null;
}

export function NewSessionModal({ open, onClose, preselectedProjectId }: NewSessionModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [mode, setMode] = useState<SessionMode>('local');
  const [branch, setBranch] = useState('');
  const [worktreeName, setWorktreeName] = useState('');
  const [createBranch, setCreateBranch] = useState(false);

  const { data: allProjects, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: api.getProjects,
    enabled: open,
  });

  // If we have a preselected project, skip project selection
  const hasPreselectedProject = !!preselectedProjectId;

  // Fetch branches when a project is selected and mode is worktree
  const projectForBranches = selectedProjectId || preselectedProjectId;
  const { data: branchesData } = useQuery({
    queryKey: ['branches-for-worktree', projectForBranches],
    queryFn: async () => {
      // We need a session to fetch branches — use a temporary approach via project
      // Fetch branches by listing them directly
      const project = allProjects?.find(p => p.id === projectForBranches);
      if (!project) return null;
      // Use the git branches endpoint — but it requires a session. Instead, we list worktrees
      // and available branches via a dedicated call.
      // For now, fetch existing worktrees to know which branches are taken
      const worktrees = await api.getWorktrees(projectForBranches!);
      return { worktrees };
    },
    enabled: open && mode === 'worktree' && !!projectForBranches,
  });

  const createSessionMutation = useMutation({
    mutationFn: (projectId?: string) => api.createSession(projectId),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['sidebar-data'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      onClose();
      navigate(`/sessions/${session.id}`);
    },
  });

  const createWorktreeMutation = useMutation({
    mutationFn: (data: { projectId: string; branch: string; name: string; createBranch?: boolean }) =>
      api.createWorktree(data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['sidebar-data'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      onClose();
      navigate(`/sessions/${result.session.id}`);
    },
  });

  const isPending = createSessionMutation.isPending || createWorktreeMutation.isPending;

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setSelectedProjectId(preselectedProjectId || null);
      setMode('local');
      setBranch('');
      setWorktreeName('');
      setCreateBranch(false);
      createSessionMutation.reset();
      createWorktreeMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preselectedProjectId]);

  // Auto-fill worktree name from branch
  useEffect(() => {
    if (branch && !worktreeName) {
      // Don't auto-fill if user has typed something
    }
  }, [branch, worktreeName]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) onClose();
    },
    [onClose, isPending]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [open, handleKeyDown]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  if (!open) return null;

  const effectiveProjectId = selectedProjectId || preselectedProjectId;

  const handleCreate = () => {
    if (mode === 'worktree' && effectiveProjectId) {
      createWorktreeMutation.mutate({
        projectId: effectiveProjectId,
        branch,
        name: worktreeName || branch,
        createBranch,
      });
    } else {
      createSessionMutation.mutate(effectiveProjectId ?? undefined);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isPending) onClose();
  };

  const canCreate = mode === 'local' || (mode === 'worktree' && branch.trim().length > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-lg mx-4 bg-background border border-border rounded-lg shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">New Session</h2>
          <button
            onClick={onClose}
            disabled={isPending}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {/* Project selection (only if no preselected project) */}
          {!hasPreselectedProject && (
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-2 block">Project</label>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                <button
                  onClick={() => { setSelectedProjectId(null); setMode('local'); }}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors',
                    !selectedProjectId
                      ? 'bg-primary/10 border border-primary/30'
                      : 'hover:bg-accent border border-transparent'
                  )}
                >
                  <FolderGit2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm">No Project</span>
                </button>

                {projectsLoading && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}

                {allProjects?.filter(p => !p.isMultiProject).map((project: Project) => (
                  <button
                    key={project.id}
                    onClick={() => setSelectedProjectId(project.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors',
                      selectedProjectId === project.id
                        ? 'bg-primary/10 border border-primary/30'
                        : 'hover:bg-accent border border-transparent'
                    )}
                  >
                    <FolderGit2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm truncate">{project.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Session type toggle (only when a project is selected) */}
          {effectiveProjectId && (
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-2 block">Type</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setMode('local')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors border',
                    mode === 'local'
                      ? 'bg-primary/10 border-primary/30 text-foreground'
                      : 'border-transparent hover:bg-accent text-muted-foreground'
                  )}
                >
                  <GitBranch className="size-3.5" />
                  Local
                </button>
                <button
                  onClick={() => setMode('worktree')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors border',
                    mode === 'worktree'
                      ? 'bg-primary/10 border-primary/30 text-foreground'
                      : 'border-transparent hover:bg-accent text-muted-foreground'
                  )}
                >
                  <Layers className="size-3.5" />
                  Worktree
                </button>
              </div>
            </div>
          )}

          {/* Worktree config (only when worktree mode) */}
          {mode === 'worktree' && effectiveProjectId && (
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Branch</label>
                <input
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="e.g. feature/auth or existing branch name"
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <label className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={createBranch}
                    onChange={(e) => setCreateBranch(e.target.checked)}
                    className="rounded border-border"
                  />
                  Create new branch (if it doesn't exist)
                </label>
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Name</label>
                <input
                  type="text"
                  value={worktreeName}
                  onChange={(e) => setWorktreeName(e.target.value)}
                  placeholder={branch || 'worktree name'}
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  Optional — defaults to branch name
                </p>
              </div>
            </div>
          )}

          {/* Error display */}
          {(createSessionMutation.error || createWorktreeMutation.error) && (
            <p className="text-sm text-red-500">
              {(createSessionMutation.error || createWorktreeMutation.error)?.message}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isPending || !canCreate}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Creating...
              </>
            ) : mode === 'worktree' ? (
              'Create Worktree Session'
            ) : (
              'Create Session'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
cd packages/ui && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/NewSessionModal.tsx
git commit -m "feat: redesign new session modal with local/worktree mode toggle"
```

---

### Task 7: Terminal CWD Resolution for Worktree Sessions

**Files:**
- Modify: `packages/api/src/routes/sessions.routes.ts` (terminal creation section, if it exists here)
- Or check where terminal creation resolves the CWD

- [ ] **Step 1: Find terminal creation route**

Run:
```bash
grep -rn "terminals" packages/api/src/routes/ --include="*.ts" | grep -i "create\|post"
```

Find where `POST /sessions/:id/terminals` is defined.

- [ ] **Step 2: Update terminal CWD resolution**

Wherever the terminal creation route resolves the working directory (CWD) for the spawned process, apply the same pattern:

```typescript
// Resolve CWD for terminal
let cwd = body.cwd;
if (!cwd && session.worktreeId && session.worktree) {
  cwd = session.worktree.path;
} else if (!cwd && session.project) {
  cwd = session.project.localPath;
}
```

Ensure the session fetch for terminal creation includes `worktree` in the `with` clause.

- [ ] **Step 3: Verify TypeScript compiles**

Run:
```bash
cd packages/api && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/
git commit -m "feat: resolve terminal CWD from worktree path when applicable"
```

---

### Task 8: Build Verification and Integration Test

**Files:** None (verification only)

- [ ] **Step 1: Run full TypeScript check for API**

```bash
cd packages/api && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: Run full TypeScript check for UI**

```bash
cd packages/ui && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Run build**

```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent && npm run build
```

Or if using bun:

```bash
bun run build
```

Expected: Build succeeds.

- [ ] **Step 4: Run lint if configured**

```bash
npm run lint 2>/dev/null || echo "No lint script"
```

Expected: Pass or no lint script.

- [ ] **Step 5: Self code review**

Run `git diff HEAD~8` (or however many commits were made) and review:
- No debug code left behind
- No security issues (path traversal in worktree paths)
- Consistent naming
- No duplicate imports
- All routes properly authenticated

- [ ] **Step 6: Fix any issues found**

If issues found, fix and commit with descriptive message.
