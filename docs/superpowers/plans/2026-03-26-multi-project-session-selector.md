# Multi-Project Session Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toolbar project selector dropdown for multi-project sessions so that Git, Run, Files, Env, Docker, Preview, and VS Code tools operate on the selected child project.

**Architecture:** A `selectedProjectId` state in `Session.tsx` drives an `activeProject` derivation. For multi-project sessions, tool buttons are disabled until a child project is selected. The active project ID threads into GitPanel sub-components and is used to scope all git and terminal API calls. Files browsing uses the existing symlink approach via FileExplorer's internal selector, pre-seeded by the toolbar selection.

**Tech Stack:** React 18, Elysia (Bun), Drizzle ORM, TanStack React Query, Zustand, Lucide React, xterm.js, TypeScript

---

## File Map

| File | Change |
|------|--------|
| `packages/api/src/routes/sessions.routes.ts` | Add `resolveTargetPath` helper; add `projectId` to all git write routes + branches/log |
| `packages/api/src/routes/terminals.routes.ts` | Add optional `cwd` body param |
| `packages/ui/src/lib/api.ts` | Add `projectId` to git functions; add `cwd` to `CreateTerminalInput` |
| `packages/ui/src/components/git/GitPanel.tsx` | Thread `projectId` prop to sub-components |
| `packages/ui/src/components/git/GitToolbar.tsx` | Add `projectId` to queries/mutations |
| `packages/ui/src/components/git/GitChangesTab.tsx` | Add `projectId` to queries/mutations |
| `packages/ui/src/components/git/GitLogTab.tsx` | Add `projectId` to query |
| `packages/ui/src/components/git/GitBranchesTab.tsx` | Add `projectId` to query/mutation |
| `packages/ui/src/components/FileExplorer.tsx` | Add `selectedProjectId` prop for pre-selection |
| `packages/ui/src/pages/Session.tsx` | State + derivation + toolbar dropdown + panel updates |

---

## Task 1: Backend — Add `resolveTargetPath` helper to sessions.routes.ts

**Files:**
- Modify: `packages/api/src/routes/sessions.routes.ts`

- [ ] **Step 1: Add the helper function after the imports block (around line 9)**

The helper resolves a session's project path to a child project's path when `projectId` is given.

```typescript
/** Resolve target path for git operations, optionally scoped to a child project. */
async function resolveTargetPath(
  project: { id: string; localPath: string; isMultiProject: boolean } | null | undefined,
  projectId: string | undefined
): Promise<string | null> {
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

- [ ] **Step 2: Commit**

```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent
git add packages/api/src/routes/sessions.routes.ts
git commit -m "feat: add resolveTargetPath helper for multi-project git operations"
```

---

## Task 2: Backend — Update git write routes to accept `projectId`

**Files:**
- Modify: `packages/api/src/routes/sessions.routes.ts`

- [ ] **Step 1: Update `git/stage` route (around line 311)**

Replace:
```typescript
  .post('/:id/git/stage', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    try {
      await gitService.stage(session.project.localPath, body.files);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ files: t.Array(t.String()) }),
  })
```

With:
```typescript
  .post('/:id/git/stage', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    const targetPath = await resolveTargetPath(session.project, body.projectId);
    if (!targetPath) { set.status = 404; return { error: 'Linked project not found' }; }
    try {
      await gitService.stage(targetPath, body.files);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ files: t.Array(t.String()), projectId: t.Optional(t.String()) }),
  })
```

- [ ] **Step 2: Update `git/unstage` route (around line 327)**

Replace:
```typescript
  .post('/:id/git/unstage', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    try {
      await gitService.unstage(session.project.localPath, body.files);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ files: t.Array(t.String()) }),
  })
```

With:
```typescript
  .post('/:id/git/unstage', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    const targetPath = await resolveTargetPath(session.project, body.projectId);
    if (!targetPath) { set.status = 404; return { error: 'Linked project not found' }; }
    try {
      await gitService.unstage(targetPath, body.files);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ files: t.Array(t.String()), projectId: t.Optional(t.String()) }),
  })
```

- [ ] **Step 3: Update `git/commit` route (around line 343)**

Replace:
```typescript
  .post('/:id/git/commit', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    try {
      const hash = await gitService.commit(session.project.localPath, body.message);
      return { success: true, hash };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ message: t.String() }),
  })
```

With:
```typescript
  .post('/:id/git/commit', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    const targetPath = await resolveTargetPath(session.project, body.projectId);
    if (!targetPath) { set.status = 404; return { error: 'Linked project not found' }; }
    try {
      const hash = await gitService.commit(targetPath, body.message);
      return { success: true, hash };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ message: t.String(), projectId: t.Optional(t.String()) }),
  })
```

- [ ] **Step 4: Update `git/checkout` route (around line 359)**

Replace:
```typescript
  .post('/:id/git/checkout', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    try {
      await gitService.checkout(session.project.localPath, body.branch, body.create || false);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ branch: t.String(), create: t.Optional(t.Boolean()) }),
  })
```

With:
```typescript
  .post('/:id/git/checkout', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    const targetPath = await resolveTargetPath(session.project, body.projectId);
    if (!targetPath) { set.status = 404; return { error: 'Linked project not found' }; }
    try {
      await gitService.checkout(targetPath, body.branch, body.create || false);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ branch: t.String(), create: t.Optional(t.Boolean()), projectId: t.Optional(t.String()) }),
  })
```

- [ ] **Step 5: Update `git/pull` route (around line 375)**

Replace:
```typescript
  .post('/:id/git/pull', async ({ user, params, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    try {
      await gitService.pull(session.project.localPath);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, { params: t.Object({ id: t.String() }) })
```

With:
```typescript
  .post('/:id/git/pull', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    const targetPath = await resolveTargetPath(session.project, body?.projectId);
    if (!targetPath) { set.status = 404; return { error: 'Linked project not found' }; }
    try {
      await gitService.pull(targetPath);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Optional(t.Object({ projectId: t.Optional(t.String()) })),
  })
```

- [ ] **Step 6: Update `git/push` route (around line 388)**

Replace:
```typescript
  .post('/:id/git/push', async ({ user, params, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    try {
      await gitService.push(session.project.localPath);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, { params: t.Object({ id: t.String() }) })
```

With:
```typescript
  .post('/:id/git/push', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    const targetPath = await resolveTargetPath(session.project, body?.projectId);
    if (!targetPath) { set.status = 404; return { error: 'Linked project not found' }; }
    try {
      await gitService.push(targetPath);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Optional(t.Object({ projectId: t.Optional(t.String()) })),
  })
```

- [ ] **Step 7: Update `git/fetch` route (around line 401)**

Replace:
```typescript
  .post('/:id/git/fetch', async ({ user, params, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    try {
      await gitService.fetch(session.project.localPath);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, { params: t.Object({ id: t.String() }) })
```

With:
```typescript
  .post('/:id/git/fetch', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    const targetPath = await resolveTargetPath(session.project, body?.projectId);
    if (!targetPath) { set.status = 404; return { error: 'Linked project not found' }; }
    try {
      await gitService.fetch(targetPath);
      return { success: true };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Optional(t.Object({ projectId: t.Optional(t.String()) })),
  })
```

- [ ] **Step 8: Update `git/log` route (around line 414) — add `projectId` query param**

Replace:
```typescript
  .get('/:id/git/log', async ({ user, params, query, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    try {
      const limit = query.limit ? parseInt(query.limit) : 50;
      const commits = await gitService.log(session.project.localPath, limit);
      return { commits };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    query: t.Object({ limit: t.Optional(t.String()) }),
  })
```

With:
```typescript
  .get('/:id/git/log', async ({ user, params, query, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    const targetPath = await resolveTargetPath(session.project, query.projectId);
    if (!targetPath) { set.status = 404; return { error: 'Linked project not found' }; }
    try {
      const limit = query.limit ? parseInt(query.limit) : 50;
      const commits = await gitService.log(targetPath, limit);
      return { commits };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    query: t.Object({ limit: t.Optional(t.String()), projectId: t.Optional(t.String()) }),
  })
```

- [ ] **Step 9: Update `git/branches` route (around line 431) — add `projectId` query param**

Replace:
```typescript
  .get('/:id/git/branches', async ({ user, params, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    try {
      const branches = await gitService.listBranches(session.project.localPath);
      const status = await gitService.status(session.project.localPath);
      return { ...branches, current: status.branch };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, { params: t.Object({ id: t.String() }) })
```

With:
```typescript
  .get('/:id/git/branches', async ({ user, params, query, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(eq(claudeSessions.id, params.id), eq(claudeSessions.userId, user!.id)),
      with: { project: true },
    });
    if (!session?.project) { set.status = 404; return { error: 'Session or project not found' }; }
    const targetPath = await resolveTargetPath(session.project, query.projectId);
    if (!targetPath) { set.status = 404; return { error: 'Linked project not found' }; }
    try {
      const branches = await gitService.listBranches(targetPath);
      const status = await gitService.status(targetPath);
      return { ...branches, current: status.branch };
    } catch (error) { set.status = 500; return { error: (error as Error).message }; }
  }, {
    params: t.Object({ id: t.String() }),
    query: t.Object({ projectId: t.Optional(t.String()) }),
  })
```

- [ ] **Step 10: Run TypeScript check**

```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent
bun run --filter ./packages/api tsc --noEmit 2>&1 | head -50
```

Expected: no errors (or only pre-existing errors unrelated to this change).

- [ ] **Step 11: Commit**

```bash
git add packages/api/src/routes/sessions.routes.ts
git commit -m "feat: add projectId support to all git routes for multi-project sessions"
```

---

## Task 3: Backend — Add `cwd` param to terminal creation

**Files:**
- Modify: `packages/api/src/routes/terminals.routes.ts:76,146-155`

- [ ] **Step 1: Update the `cwd` assignment (line 76)**

Replace:
```typescript
    const cwd = session.project?.localPath || userWorkspace;
```

With:
```typescript
    const cwd = body.cwd || session.project?.localPath || userWorkspace;
```

- [ ] **Step 2: Add `cwd` to the body schema (around line 146)**

Replace:
```typescript
    body: t.Object({
      sessionId: t.String(),
      name: t.Optional(t.String()),
      type: t.Optional(t.Union([t.Literal('shell'), t.Literal('claude'), t.Literal('process')])),
      command: t.Optional(t.Array(t.String())),
      cols: t.Optional(t.Number()),
      rows: t.Optional(t.Number()),
      persist: t.Optional(t.Boolean()),
      initialPrompt: t.Optional(t.String()),
    }),
```

With:
```typescript
    body: t.Object({
      sessionId: t.String(),
      name: t.Optional(t.String()),
      type: t.Optional(t.Union([t.Literal('shell'), t.Literal('claude'), t.Literal('process')])),
      command: t.Optional(t.Array(t.String())),
      cols: t.Optional(t.Number()),
      rows: t.Optional(t.Number()),
      persist: t.Optional(t.Boolean()),
      initialPrompt: t.Optional(t.String()),
      cwd: t.Optional(t.String()),
    }),
```

- [ ] **Step 3: Run TypeScript check**

```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent
bun run --filter ./packages/api tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/terminals.routes.ts
git commit -m "feat: add optional cwd param to terminal creation"
```

---

## Task 4: Frontend — Update api.ts

**Files:**
- Modify: `packages/ui/src/lib/api.ts`

- [ ] **Step 1: Add `projectId` to git write functions (around line 61)**

Replace:
```typescript
  gitStage: (sessionId: string, files: string[]) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/git/stage`, {
      method: 'POST',
      body: JSON.stringify({ files }),
    }),
  gitUnstage: (sessionId: string, files: string[]) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/git/unstage`, {
      method: 'POST',
      body: JSON.stringify({ files }),
    }),
  gitCommit: (sessionId: string, message: string) =>
    request<{ success: boolean; hash: string }>(`/sessions/${sessionId}/git/commit`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
  gitCheckout: (sessionId: string, branch: string, create?: boolean) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/git/checkout`, {
      method: 'POST',
      body: JSON.stringify({ branch, create }),
    }),
  gitSessionPull: (sessionId: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/git/pull`, { method: 'POST' }),
  gitSessionPush: (sessionId: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/git/push`, { method: 'POST' }),
  gitSessionFetch: (sessionId: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/git/fetch`, { method: 'POST' }),
  getSessionGitLog: (sessionId: string, limit?: number) =>
    request<{ commits: GitLogEntry[] }>(`/sessions/${sessionId}/git/log${limit ? `?limit=${limit}` : ''}`),
  getSessionGitBranches: (sessionId: string) =>
    request<GitBranches>(`/sessions/${sessionId}/git/branches`),
```

With:
```typescript
  gitStage: (sessionId: string, files: string[], projectId?: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/git/stage`, {
      method: 'POST',
      body: JSON.stringify({ files, projectId }),
    }),
  gitUnstage: (sessionId: string, files: string[], projectId?: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/git/unstage`, {
      method: 'POST',
      body: JSON.stringify({ files, projectId }),
    }),
  gitCommit: (sessionId: string, message: string, projectId?: string) =>
    request<{ success: boolean; hash: string }>(`/sessions/${sessionId}/git/commit`, {
      method: 'POST',
      body: JSON.stringify({ message, projectId }),
    }),
  gitCheckout: (sessionId: string, branch: string, create?: boolean, projectId?: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/git/checkout`, {
      method: 'POST',
      body: JSON.stringify({ branch, create, projectId }),
    }),
  gitSessionPull: (sessionId: string, projectId?: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/git/pull`, {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),
  gitSessionPush: (sessionId: string, projectId?: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/git/push`, {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),
  gitSessionFetch: (sessionId: string, projectId?: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/git/fetch`, {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),
  getSessionGitLog: (sessionId: string, limit?: number, projectId?: string) => {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (projectId) params.set('projectId', projectId);
    const query = params.toString();
    return request<{ commits: GitLogEntry[] }>(`/sessions/${sessionId}/git/log${query ? `?${query}` : ''}`);
  },
  getSessionGitBranches: (sessionId: string, projectId?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    const query = params.toString();
    return request<GitBranches>(`/sessions/${sessionId}/git/branches${query ? `?${query}` : ''}`);
  },
```

- [ ] **Step 2: Add `cwd` to `CreateTerminalInput` interface (around line 675)**

Replace:
```typescript
export interface CreateTerminalInput {
  sessionId: string;
  name?: string;
  type?: TerminalType;
  command?: string[];
  cols?: number;
  rows?: number;
  persist?: boolean;
  initialPrompt?: string;
}
```

With:
```typescript
export interface CreateTerminalInput {
  sessionId: string;
  name?: string;
  type?: TerminalType;
  command?: string[];
  cols?: number;
  rows?: number;
  persist?: boolean;
  initialPrompt?: string;
  cwd?: string;
}
```

- [ ] **Step 3: Run TypeScript check**

```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent
bun run --filter ./packages/ui tsc --noEmit 2>&1 | head -50
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/lib/api.ts
git commit -m "feat: add projectId to git api functions and cwd to CreateTerminalInput"
```

---

## Task 5: Frontend — Thread `projectId` through GitPanel sub-components

**Files:**
- Modify: `packages/ui/src/components/git/GitPanel.tsx`
- Modify: `packages/ui/src/components/git/GitToolbar.tsx`
- Modify: `packages/ui/src/components/git/GitChangesTab.tsx`
- Modify: `packages/ui/src/components/git/GitLogTab.tsx`
- Modify: `packages/ui/src/components/git/GitBranchesTab.tsx`

- [ ] **Step 1: Update `GitPanel.tsx` — add `projectId` prop and thread it**

Replace:
```typescript
interface GitPanelProps {
  sessionId: string;
  project?: Project;
  className?: string;
  onProceed?: (message: string) => void;
}

export function GitPanel({ sessionId, project: _project, className, onProceed }: GitPanelProps) {
```

With:
```typescript
interface GitPanelProps {
  sessionId: string;
  project?: Project;
  projectId?: string;
  className?: string;
  onProceed?: (message: string) => void;
}

export function GitPanel({ sessionId, project: _project, projectId, className, onProceed }: GitPanelProps) {
```

Replace (the sub-component usages, around line 35 and 58-60):
```typescript
      <GitToolbar sessionId={sessionId} onReview={handleReview} />
```
With:
```typescript
      <GitToolbar sessionId={sessionId} projectId={projectId} onReview={handleReview} />
```

Replace:
```typescript
        {activeTab === 'changes' && <GitChangesTab sessionId={sessionId} onProceed={onProceed} />}
        {activeTab === 'log' && <GitLogTab sessionId={sessionId} />}
        {activeTab === 'branches' && <GitBranchesTab sessionId={sessionId} />}
```
With:
```typescript
        {activeTab === 'changes' && <GitChangesTab sessionId={sessionId} projectId={projectId} onProceed={onProceed} />}
        {activeTab === 'log' && <GitLogTab sessionId={sessionId} projectId={projectId} />}
        {activeTab === 'branches' && <GitBranchesTab sessionId={sessionId} projectId={projectId} />}
```

- [ ] **Step 2: Update `GitToolbar.tsx` — add `projectId` prop to interface and all usages**

Replace:
```typescript
interface GitToolbarProps {
  sessionId: string;
  onReview?: () => void;
}

export function GitToolbar({ sessionId, onReview }: GitToolbarProps) {
```
With:
```typescript
interface GitToolbarProps {
  sessionId: string;
  projectId?: string;
  onReview?: () => void;
}

export function GitToolbar({ sessionId, projectId, onReview }: GitToolbarProps) {
```

Replace (the query, line 28-32):
```typescript
  const { data: gitStatus } = useQuery({
    queryKey: ['session-git-status', sessionId],
    queryFn: () => api.getSessionGitStatus(sessionId),
    refetchInterval: 3000,
  });

  const { data: branches } = useQuery({
    queryKey: ['session-git-branches', sessionId],
    queryFn: () => api.getSessionGitBranches(sessionId),
    enabled: showBranchDropdown,
  });
```
With:
```typescript
  const { data: gitStatus } = useQuery({
    queryKey: ['session-git-status', sessionId, projectId],
    queryFn: () => api.getSessionGitStatus(sessionId, projectId),
    refetchInterval: 3000,
  });

  const { data: branches } = useQuery({
    queryKey: ['session-git-branches', sessionId, projectId],
    queryFn: () => api.getSessionGitBranches(sessionId, projectId),
    enabled: showBranchDropdown,
  });
```

Replace (the `invalidateGit` function, line 40-44):
```typescript
  const invalidateGit = () => {
    queryClient.invalidateQueries({ queryKey: ['session-git-status', sessionId] });
    queryClient.invalidateQueries({ queryKey: ['session-git-log', sessionId] });
    queryClient.invalidateQueries({ queryKey: ['session-git-branches', sessionId] });
  };
```
With:
```typescript
  const invalidateGit = () => {
    queryClient.invalidateQueries({ queryKey: ['session-git-status', sessionId, projectId] });
    queryClient.invalidateQueries({ queryKey: ['session-git-log', sessionId, projectId] });
    queryClient.invalidateQueries({ queryKey: ['session-git-branches', sessionId, projectId] });
  };
```

Replace each mutation to pass `projectId`:
```typescript
  const checkoutMutation = useMutation({
    mutationFn: (branch: string) => api.gitCheckout(sessionId, branch),
```
With:
```typescript
  const checkoutMutation = useMutation({
    mutationFn: (branch: string) => api.gitCheckout(sessionId, branch, undefined, projectId),
```

```typescript
  const pullMutation = useMutation({
    mutationFn: () => api.gitSessionPull(sessionId),
```
With:
```typescript
  const pullMutation = useMutation({
    mutationFn: () => api.gitSessionPull(sessionId, projectId),
```

```typescript
  const pushMutation = useMutation({
    mutationFn: () => api.gitSessionPush(sessionId),
```
With:
```typescript
  const pushMutation = useMutation({
    mutationFn: () => api.gitSessionPush(sessionId, projectId),
```

```typescript
  const fetchMutation = useMutation({
    mutationFn: () => api.gitSessionFetch(sessionId),
```
With:
```typescript
  const fetchMutation = useMutation({
    mutationFn: () => api.gitSessionFetch(sessionId, projectId),
```

- [ ] **Step 3: Update `GitChangesTab.tsx` — add `projectId` prop**

The `GitChangesTab` component has a props interface and `sessionId` parameter. Find its interface (it may be implicit/inline) and update.

Find the component function signature. It likely looks like:
```typescript
export function GitChangesTab({ sessionId, onProceed }: { sessionId: string; onProceed?: (message: string) => void }) {
```

Replace it with:
```typescript
export function GitChangesTab({ sessionId, projectId, onProceed }: { sessionId: string; projectId?: string; onProceed?: (message: string) => void }) {
```

Replace the git status query (around line 93-100):
```typescript
  const {
    data: gitStatus,
    isLoading: statusLoading,
  } = useQuery({
    queryKey: ['session-git-status', sessionId],
    queryFn: () => api.getSessionGitStatus(sessionId),
    refetchInterval: 3000,
  });
```
With:
```typescript
  const {
    data: gitStatus,
    isLoading: statusLoading,
  } = useQuery({
    queryKey: ['session-git-status', sessionId, projectId],
    queryFn: () => api.getSessionGitStatus(sessionId, projectId),
    refetchInterval: 3000,
  });
```

Replace the file diff query (around line 102-106):
```typescript
  const { data: diffData, isLoading: diffLoading } = useQuery({
    queryKey: ['session-file-diff', sessionId, selectedFile],
    queryFn: () => api.getSessionFileDiff(sessionId, selectedFile!),
    enabled: !!selectedFile,
  });
```
With:
```typescript
  const { data: diffData, isLoading: diffLoading } = useQuery({
    queryKey: ['session-file-diff', sessionId, selectedFile, projectId],
    queryFn: () => api.getSessionFileDiff(sessionId, selectedFile!, projectId),
    enabled: !!selectedFile,
  });
```

Replace `invalidateGit` (around line 108-111):
```typescript
  const invalidateGit = () => {
    queryClient.invalidateQueries({ queryKey: ['session-git-status', sessionId] });
    queryClient.invalidateQueries({ queryKey: ['session-git-log', sessionId] });
  };
```
With:
```typescript
  const invalidateGit = () => {
    queryClient.invalidateQueries({ queryKey: ['session-git-status', sessionId, projectId] });
    queryClient.invalidateQueries({ queryKey: ['session-git-log', sessionId, projectId] });
  };
```

Replace the mutations (around lines 113-133):
```typescript
  const stageMutation = useMutation({
    mutationFn: (files: string[]) => api.gitStage(sessionId, files),
    onSuccess: invalidateGit,
    onError: (e) => toast({ title: 'Stage failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const unstageMutation = useMutation({
    mutationFn: (files: string[]) => api.gitUnstage(sessionId, files),
    onSuccess: invalidateGit,
    onError: (e) => toast({ title: 'Unstage failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const commitMutation = useMutation({
    mutationFn: (message: string) => api.gitCommit(sessionId, message),
```
With:
```typescript
  const stageMutation = useMutation({
    mutationFn: (files: string[]) => api.gitStage(sessionId, files, projectId),
    onSuccess: invalidateGit,
    onError: (e) => toast({ title: 'Stage failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const unstageMutation = useMutation({
    mutationFn: (files: string[]) => api.gitUnstage(sessionId, files, projectId),
    onSuccess: invalidateGit,
    onError: (e) => toast({ title: 'Unstage failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const commitMutation = useMutation({
    mutationFn: (message: string) => api.gitCommit(sessionId, message, projectId),
```

- [ ] **Step 4: Update `GitLogTab.tsx`**

Find the component signature (likely `export function GitLogTab({ sessionId }: { sessionId: string }) {`) and update:
```typescript
export function GitLogTab({ sessionId, projectId }: { sessionId: string; projectId?: string }) {
```

Find the query (line 23):
```typescript
    queryKey: ['session-git-log', sessionId],
    queryFn: () => api.getSessionGitLog(sessionId, 50),
```
Replace with:
```typescript
    queryKey: ['session-git-log', sessionId, projectId],
    queryFn: () => api.getSessionGitLog(sessionId, 50, projectId),
```

- [ ] **Step 5: Update `GitBranchesTab.tsx`**

Find the component signature (likely `export function GitBranchesTab({ sessionId }: { sessionId: string }) {`) and update:
```typescript
export function GitBranchesTab({ sessionId, projectId }: { sessionId: string; projectId?: string }) {
```

Find the query (line 23):
```typescript
    queryKey: ['session-git-branches', sessionId],
    queryFn: () => api.getSessionGitBranches(sessionId),
```
Replace with:
```typescript
    queryKey: ['session-git-branches', sessionId, projectId],
    queryFn: () => api.getSessionGitBranches(sessionId, projectId),
```

Find the checkout mutation (line 28):
```typescript
    mutationFn: (branch: string) => api.gitCheckout(sessionId, branch),
```
Replace with:
```typescript
    mutationFn: (branch: string) => api.gitCheckout(sessionId, branch, undefined, projectId),
```

- [ ] **Step 6: Run TypeScript check**

```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent
bun run --filter ./packages/ui tsc --noEmit 2>&1 | head -50
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/git/
git commit -m "feat: thread projectId through GitPanel and git sub-components"
```

---

## Task 6: Frontend — Add `selectedProjectId` prop to FileExplorer

**Files:**
- Modify: `packages/ui/src/components/FileExplorer.tsx`

- [ ] **Step 1: Add `selectedProjectId` prop and sync effect**

Replace:
```typescript
interface FileExplorerProps {
  sessionId: string;
  project?: Project;
  className?: string;
}

export function FileExplorer({ sessionId, project, className }: FileExplorerProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
```

With:
```typescript
interface FileExplorerProps {
  sessionId: string;
  project?: Project;
  selectedProjectId?: string | null;
  className?: string;
}

export function FileExplorer({ sessionId, project, selectedProjectId: externalSelectedProjectId, className }: FileExplorerProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(externalSelectedProjectId ?? null);

  // Sync with external selection (from toolbar project selector)
  useEffect(() => {
    if (externalSelectedProjectId !== undefined) {
      setSelectedProjectId(externalSelectedProjectId);
    }
  }, [externalSelectedProjectId]);
```

Also add `useEffect` to the imports at the top of the file:
```typescript
import { useState, useEffect } from 'react';
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent
bun run --filter ./packages/ui tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/FileExplorer.tsx
git commit -m "feat: add selectedProjectId prop to FileExplorer for toolbar pre-selection"
```

---

## Task 7: Frontend — Add state + activeProject derivation to Session.tsx

**Files:**
- Modify: `packages/ui/src/pages/Session.tsx`

- [ ] **Step 1: Add `useEffect` and `useMemo` to React import**

Replace line 1:
```typescript
import { useState, useMemo, useRef } from 'react';
```
With:
```typescript
import { useState, useMemo, useRef, useEffect } from 'react';
```

- [ ] **Step 2: Add `selectedProjectId` state, reset effect, and `activeProject` derivation**

After line 323 (`const [showThemeSelector, setShowThemeSelector] = useState(false);`), add:

```typescript
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Reset child project selection when navigating to a different session
  useEffect(() => {
    setSelectedProjectId(null);
  }, [id]);

  // Resolve the active project: child project if multi-project session with selection, else the session's project
  const activeProject = useMemo(() => {
    if (!session?.project) return null;
    if (session.project.isMultiProject) {
      if (!selectedProjectId) return null;
      return session.project.childLinks
        ?.find(l => l.childProjectId === selectedProjectId)
        ?.childProject ?? null;
    }
    return session.project;
  }, [session, selectedProjectId]);

  // The project ID to pass to git operations (only for child project context)
  const gitProjectId = session?.project?.isMultiProject ? (activeProject?.id ?? undefined) : undefined;

  // The alias for the selected child project (used to badge terminal names)
  const selectedAlias = useMemo(() => {
    if (!selectedProjectId || !session?.project?.childLinks) return null;
    return session.project.childLinks.find(l => l.childProjectId === selectedProjectId)?.alias ?? null;
  }, [selectedProjectId, session]);
```

- [ ] **Step 3: Update the git status query (around line 341)**

Replace:
```typescript
  const { data: gitStatus } = useQuery({
    queryKey: ['session-git-status', id],
    queryFn: () => api.getSessionGitStatus(id!),
    refetchInterval: 3000,
    enabled: !!id && !!session?.project,
  });
```
With:
```typescript
  const { data: gitStatus } = useQuery({
    queryKey: ['session-git-status', id, gitProjectId],
    queryFn: () => api.getSessionGitStatus(id!, gitProjectId),
    refetchInterval: 3000,
    enabled: !!id && !!activeProject,
  });
```

- [ ] **Step 4: Update `canOpenEditor` to use `activeProject`**

Replace (around line 401):
```typescript
  const canOpenEditor = !!editorStatus?.configured && !!session?.project?.localPath;
```
With:
```typescript
  const canOpenEditor = !!editorStatus?.configured && !!activeProject?.localPath;
```

- [ ] **Step 5: Run TypeScript check**

```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent
bun run --filter ./packages/ui tsc --noEmit 2>&1 | head -50
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/pages/Session.tsx
git commit -m "feat: add selectedProjectId state and activeProject derivation to Session"
```

---

## Task 8: Frontend — Add project selector dropdown to Session.tsx toolbar

**Files:**
- Modify: `packages/ui/src/pages/Session.tsx`

- [ ] **Step 1: Add `ProjectSelector` import**

After line 44 (`import { ThemeSelector } from '@/components/ThemeSelector';`), add:
```typescript
import { ProjectSelector } from '@/components/ProjectSelector';
```

- [ ] **Step 2: Replace the static project name ToolBtn with conditional dropdown**

Find the static project name button (around line 460-463):
```typescript
            <ToolBtn
              label={session?.project?.name || 'Session'}
              className="font-semibold text-foreground/90 px-2"
            />
```

Replace with:
```typescript
            {session?.project?.isMultiProject && session.project.childLinks && session.project.childLinks.length > 0 ? (
              <div className="flex items-center self-stretch px-1">
                <ProjectSelector
                  links={session.project.childLinks}
                  selectedProjectId={selectedProjectId}
                  onSelect={(id) => {
                    setSelectedProjectId(id);
                    // Auto-switch to terminal if clearing selection while a project panel is open
                    if (!id && viewMode !== 'terminal') {
                      setViewMode('terminal');
                    }
                  }}
                />
              </div>
            ) : (
              <ToolBtn
                label={session?.project?.name || 'Session'}
                className="font-semibold text-foreground/90 px-2"
              />
            )}
```

- [ ] **Step 3: Run TypeScript check**

```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent
bun run --filter ./packages/ui tsc --noEmit 2>&1 | head -50
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/pages/Session.tsx
git commit -m "feat: add project selector dropdown to toolbar for multi-project sessions"
```

---

## Task 9: Frontend — Update disabled states, panel props, terminal creation, and mobile selector

**Files:**
- Modify: `packages/ui/src/pages/Session.tsx`

- [ ] **Step 1: Update tool button disabled conditions for multi-project sessions**

The tool buttons for Git, Run, Files, Env, Docker, Preview, VS Code are currently gated on `session?.project`. For multi-project sessions, they should also require `activeProject`.

Find the Git ToolBtn (around line 495-504):
```typescript
                    {session?.project && (
                      <ToolBtn
                        icon={GitBranch}
                        label="Git"
                        badge={changeCount}
                        pill={gitStatus?.branch}
                        isActive={viewMode === 'git'}
                        onClick={() => setViewMode(viewMode === 'git' ? 'terminal' : 'git')}
                      />
                    )}
```
Replace with:
```typescript
                    {session?.project && (
                      <ToolBtn
                        icon={GitBranch}
                        label="Git"
                        badge={changeCount}
                        pill={gitStatus?.branch}
                        isActive={viewMode === 'git'}
                        disabled={session.project.isMultiProject && !activeProject}
                        onClick={() => setViewMode(viewMode === 'git' ? 'terminal' : 'git')}
                      />
                    )}
```

Find the Run/Files ToolBtns (around line 507-526):
```typescript
                  {session?.project && (
                    <>
                      <Divider />
                      <div className="flex items-stretch gap-0.5">
                        <ToolBtn
                          icon={Play}
                          label="Run"
                          isActive={viewMode === 'run'}
                          onClick={() => setViewMode(viewMode === 'run' ? 'terminal' : 'run')}
                        />
                        <ToolBtn
                          icon={FolderOpen}
                          label="Files"
                          isActive={viewMode === 'files'}
                          onClick={() => setViewMode(viewMode === 'files' ? 'terminal' : 'files')}
                        />
                      </div>
                    </>
                  )}
```
Replace with:
```typescript
                  {session?.project && (
                    <>
                      <Divider />
                      <div className="flex items-stretch gap-0.5">
                        <ToolBtn
                          icon={Play}
                          label="Run"
                          isActive={viewMode === 'run'}
                          disabled={session.project.isMultiProject && !activeProject}
                          onClick={() => setViewMode(viewMode === 'run' ? 'terminal' : 'run')}
                        />
                        <ToolBtn
                          icon={FolderOpen}
                          label="Files"
                          isActive={viewMode === 'files'}
                          disabled={session.project.isMultiProject && !activeProject}
                          onClick={() => setViewMode(viewMode === 'files' ? 'terminal' : 'files')}
                        />
                      </div>
                    </>
                  )}
```

Find the Env ToolBtn (around line 530-538):
```typescript
                    {session?.project && (
                      <ToolBtn
                        icon={KeyRound}
                        label="Env"
                        isActive={viewMode === 'env'}
                        onClick={() => setViewMode(viewMode === 'env' ? 'terminal' : 'env')}
                      />
                    )}
```
Replace with:
```typescript
                    {session?.project && (
                      <ToolBtn
                        icon={KeyRound}
                        label="Env"
                        isActive={viewMode === 'env'}
                        disabled={session.project.isMultiProject && !activeProject}
                        onClick={() => setViewMode(viewMode === 'env' ? 'terminal' : 'env')}
                      />
                    )}
```

Find the Docker and Preview ToolBtns (around line 539-554):
```typescript
                    <ToolBtn
                      icon={Container}
                      label="Docker"
                      isActive={viewMode === 'docker'}
                      onClick={() => setViewMode(viewMode === 'docker' ? 'terminal' : 'docker')}
                    />
                    <ToolBtn
                      icon={Monitor}
                      label="Preview"
                      isActive={viewMode === 'preview'}
                      onClick={() => {
                        if (viewMode === 'preview') setViewMode('terminal');
                        else if (previewId) setViewMode('preview');
                        else setShowPreviewDialog(true);
                      }}
                    />
```
Replace with:
```typescript
                    <ToolBtn
                      icon={Container}
                      label="Docker"
                      isActive={viewMode === 'docker'}
                      disabled={!!session?.project?.isMultiProject && !activeProject}
                      onClick={() => setViewMode(viewMode === 'docker' ? 'terminal' : 'docker')}
                    />
                    <ToolBtn
                      icon={Monitor}
                      label="Preview"
                      isActive={viewMode === 'preview'}
                      disabled={!!session?.project?.isMultiProject && !activeProject}
                      onClick={() => {
                        if (viewMode === 'preview') setViewMode('terminal');
                        else if (previewId) setViewMode('preview');
                        else setShowPreviewDialog(true);
                      }}
                    />
```

Find the VS Code ToolBtn (around line 557-572). It is gated on `canOpenEditor` which was already updated in Task 7 to use `activeProject`. No change needed to the ToolBtn itself.

- [ ] **Step 2: Update panel props to use `activeProject`**

Update the GitPanel usage (around line 711):
```typescript
          <GitPanel
            sessionId={id!}
            project={session?.project}
```
Replace with:
```typescript
          <GitPanel
            sessionId={id!}
            project={activeProject ?? undefined}
            projectId={gitProjectId}
```

Update the RunConfigPanel usage (around line 725):
```typescript
          <RunConfigPanel
            projectId={session!.project!.id}
```
Replace with:
```typescript
          <RunConfigPanel
            projectId={activeProject!.id}
```

Update the DockerPanel usage (around line 734):
```typescript
          <DockerPanel
            sessionId={id!}
            projectId={session?.project?.id}
```
Replace with:
```typescript
          <DockerPanel
            sessionId={id!}
            projectId={activeProject?.id}
```

Update the Env panel usage (around line 742-757):

Replace:
```typescript
        ) : viewMode === 'env' && session?.project ? (
          <div className="p-4 overflow-y-auto h-full">
            <EnvEditor projectId={session.project.id} />
            {session.project.isMultiProject && session.project.childLinks && (
              <div className="mt-6 space-y-4">
                {session.project.childLinks.map((link: any) => (
                  <div key={link.id} className="border rounded-lg p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      {link.alias || link.childProject?.name}
                    </p>
                    <EnvEditor projectId={link.childProjectId} />
                  </div>
                ))}
              </div>
            )}
          </div>
```
With:
```typescript
        ) : viewMode === 'env' && activeProject ? (
          <div className="p-4 overflow-y-auto h-full">
            <EnvEditor projectId={activeProject.id} />
          </div>
```

Update the FileExplorer usage (around line 769):
```typescript
          <FileExplorer sessionId={id!} project={session?.project} className="h-full" />
```
Replace with:
```typescript
          <FileExplorer sessionId={id!} project={session?.project} selectedProjectId={selectedProjectId} className="h-full" />
```

Update the VS Code editor mutation call (around line 567):
```typescript
                        onClick={() => openEditorMutation.mutate(session!.project!.localPath)}
```
Replace with:
```typescript
                        onClick={() => openEditorMutation.mutate(activeProject!.localPath)}
```

- [ ] **Step 3: Update terminal `createMutation` to pass `cwd` and name badge**

Replace (around line 348):
```typescript
  const createMutation = useMutation({
    mutationFn: (opts: { type?: TerminalType; name?: string; initialPrompt?: string } = {}) =>
      api.createTerminal({
        sessionId: id!,
        type: opts.type || 'shell',
        name: opts.name,
        initialPrompt: opts.initialPrompt,
      }),
```
With:
```typescript
  const createMutation = useMutation({
    mutationFn: (opts: { type?: TerminalType; name?: string; initialPrompt?: string } = {}) => {
      const prefix = selectedAlias ? `[${selectedAlias}] ` : '';
      const baseName = opts.name ?? (opts.type === 'claude' ? 'Claude' : 'Shell');
      return api.createTerminal({
        sessionId: id!,
        type: opts.type || 'shell',
        name: prefix ? `${prefix}${baseName}` : opts.name,
        initialPrompt: opts.initialPrompt,
        cwd: activeProject?.localPath,
      });
    },
```

- [ ] **Step 4: Add mobile project selector**

In the mobile section (around line 637), after the closing `</div>` of the terminal dropdown section but still within the mobile container, add a project selector for multi-project sessions:

Find the mobile terminal dropdown `<div>` opening:
```typescript
      <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b bg-card/20 shrink-0">
```

Replace with:
```typescript
      <div className="md:hidden flex flex-col border-b bg-card/20 shrink-0">
        {session?.project?.isMultiProject && session.project.childLinks && session.project.childLinks.length > 0 && (
          <div className="px-3 pt-2">
            <ProjectSelector
              links={session.project.childLinks}
              selectedProjectId={selectedProjectId}
              onSelect={(id) => {
                setSelectedProjectId(id);
                if (!id && viewMode !== 'terminal') setViewMode('terminal');
              }}
            />
          </div>
        )}
        <div className="flex items-center gap-2 px-3 py-2">
```

And close the outer div after the inner terminal dropdown closing `</div>`:
Find the end of the mobile section (around line 694) which ends with `</div>` for the mobile container. Add an extra `</div>` for the outer wrapper.

The mobile section currently ends with:
```typescript
      </div>
```
(after the terminal dropdown div). The mobile section's outermost div now has an extra closing tag — find the exact block and ensure the nesting is correct by reading the file after changes.

- [ ] **Step 5: Run TypeScript check**

```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent
bun run --filter ./packages/ui tsc --noEmit 2>&1 | head -50
```

Expected: no TypeScript errors.

- [ ] **Step 6: Run full build**

```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent
bun run build 2>&1 | tail -30
```

Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/pages/Session.tsx
git commit -m "feat: update Session.tsx with multi-project disabled states, panel props, terminal badge, and mobile selector"
```

---

## Task 10: Visual Verification

**Files:** Read-only

- [ ] **Step 1: Run the dev server and visually verify with the agent-browser skill**

Invoke the `agent-browser` skill to:
1. Navigate to the session page for a multi-project session
2. Verify: toolbar shows project selector dropdown
3. Verify: Git/Run/Files/Env/Docker/Preview buttons are disabled (grayed out) before selection
4. Select a child project and verify tools become enabled
5. Open Git panel — verify it shows the child project's git status
6. Open Files panel — verify it pre-selects the child project
7. Create a Shell terminal — verify it starts in the child project directory and has `[alias]` prefix in tab bar
8. Clear selection — verify tools become disabled again and view switches to terminal

- [ ] **Step 2: Fix any visual issues found**

Address any rendering bugs, layout problems, or TypeScript errors discovered during visual verification.

- [ ] **Step 3: Final commit if fixes were needed**

```bash
git add -p
git commit -m "fix: address visual verification issues in multi-project session selector"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Toolbar project selector dropdown for multi-project sessions (Task 8)
- ✅ Tools disabled until child project selected (Task 9, Step 1)
- ✅ Claude/Shell always enabled (not disabled in Step 1)
- ✅ activeProject resolver with null-safety (Task 7, Step 2)
- ✅ Tools auto-switch to terminal when selection cleared (Task 8, Step 2 and Task 9, Step 4)
- ✅ Git write routes accept projectId (Task 2)
- ✅ Git read routes (branches, log) accept projectId (Task 2, Steps 8-9)
- ✅ Terminal creation accepts cwd (Task 3)
- ✅ Terminal badge with alias prefix (Task 9, Step 3)
- ✅ Git status query scoped to selectedProjectId (Task 7, Step 3)
- ✅ selectedProjectId reset on session navigation (Task 7, Step 2)
- ✅ Mobile project selector (Task 9, Step 4)
- ✅ Env panel uses single activeProject EnvEditor (Task 9, Step 2)
- ✅ FileExplorer pre-seeded from toolbar selection (Task 6 + Task 9, Step 2)
- ✅ VS Code opens activeProject.localPath (Task 9, Step 2)
- ✅ api.ts types updated (Task 4)

**No placeholders found.** All steps contain actual code.

**Type consistency:** `gitProjectId` is typed as `string | undefined` and passed to git functions as `projectId?: string`. `activeProject` is typed as `Project | null`. `selectedAlias` is `string | null`. All consistent throughout.
