# Environment Variables Manager — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Per-project environment variables that get injected into every terminal (shell + claude), with automatic merging for multi-project sessions.

**Architecture:** Add `env` JSON text field to `projects` table (same pattern as `runConfigs.env`). New API endpoints for CRUD. Terminal launch reads project env and merges it into the spawn env. Multi-project sessions merge child project envs by position order. New `EnvEditor` UI component on the Session page.

**Tech Stack:** Drizzle ORM (Postgres), Elysia routes, React + TanStack Query, existing UI components (Card, Button, Input)

---

### Task 1: Add `env` field to projects schema

**Files:**
- Modify: `packages/api/src/db/schema.ts:88-100`

**Step 1: Add env field to projects table**

In `packages/api/src/db/schema.ts`, add the `env` field to the projects table definition, after `isMultiProject`:

```typescript
export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  repoUrl: text('repo_url'),
  localPath: text('local_path').notNull(),
  defaultBranch: text('default_branch').default('main'),
  sshKeyId: text('ssh_key_id').references(() => sshKeys.id),
  isMultiProject: boolean('is_multi_project').notNull().default(false),
  env: text('env'), // JSON — Record<string, string>
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```

**Step 2: Generate migration**

Run: `cd packages/api && bun run db:generate`
Expected: New migration SQL file in `drizzle/` adding `env` column to `projects` table.

**Step 3: Run migration**

Run: `cd packages/api && bun run db:migrate`
Expected: Migration applies successfully.

**Step 4: Commit**

```bash
git add packages/api/src/db/schema.ts packages/api/drizzle/
git commit -m "feat(db): add env JSON field to projects table"
```

---

### Task 2: Add project env API endpoints

**Files:**
- Modify: `packages/api/src/routes/projects.routes.ts`

**Step 1: Add GET /projects/:id/env endpoint**

Add after the existing `GET /:id` route in `projects.routes.ts`:

```typescript
  // Get project environment variables
  .get('/:id/env', async ({ user, params, set }) => {
    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.id, params.id),
        eq(projects.userId, user!.id)
      ),
      columns: { env: true },
    });

    if (!project) {
      set.status = 404;
      return { error: 'Project not found' };
    }

    return { env: project.env ? JSON.parse(project.env) : {} };
  }, {
    params: t.Object({ id: t.String() }),
  })
```

**Step 2: Add PUT /projects/:id/env endpoint**

Add after the GET env route:

```typescript
  // Update project environment variables
  .put('/:id/env', async ({ user, params, body, set }) => {
    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.id, params.id),
        eq(projects.userId, user!.id)
      ),
    });

    if (!project) {
      set.status = 404;
      return { error: 'Project not found' };
    }

    await db.update(projects)
      .set({ env: JSON.stringify(body.env), updatedAt: new Date() })
      .where(eq(projects.id, params.id));

    return { success: true };
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      env: t.Record(t.String(), t.String()),
    }),
  })
```

**Step 3: Add required imports if missing**

Ensure these are imported at top of `projects.routes.ts`:

```typescript
import { db, projects } from '../db';
import { eq, and } from 'drizzle-orm';
```

**Step 4: Verify build**

Run: `bun build packages/api/src/routes/projects.routes.ts --outdir /tmp/verify --target bun`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add packages/api/src/routes/projects.routes.ts
git commit -m "feat(api): add GET/PUT endpoints for project env vars"
```

---

### Task 3: Add env resolution service for terminal launch

**Files:**
- Create: `packages/api/src/services/workspace/env.service.ts`

**Step 1: Create env resolution service**

```typescript
import { eq } from 'drizzle-orm';
import { db, projects, projectLinks } from '../../db';

export async function resolveProjectEnv(projectId: string): Promise<Record<string, string>> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });

  if (!project) return {};

  // Single project — just parse its env
  if (!project.isMultiProject) {
    return project.env ? JSON.parse(project.env) : {};
  }

  // Multi-project — merge child envs by position order
  const links = await db.query.projectLinks.findMany({
    where: eq(projectLinks.parentProjectId, projectId),
    with: { childProject: true },
    orderBy: (l, { asc }) => [asc(l.position)],
  });

  const merged: Record<string, string> = {};

  // Parent env first (base)
  if (project.env) {
    Object.assign(merged, JSON.parse(project.env));
  }

  // Then children by position (later overrides earlier on conflicts)
  for (const link of links) {
    const child = (link as any).childProject;
    if (child?.env) {
      Object.assign(merged, JSON.parse(child.env));
    }
  }

  return merged;
}
```

**Step 2: Verify build**

Run: `bun build packages/api/src/services/workspace/env.service.ts --outdir /tmp/verify --target bun`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add packages/api/src/services/workspace/env.service.ts
git commit -m "feat: add env resolution service with multi-project merge"
```

---

### Task 4: Inject project env into terminal launch

**Files:**
- Modify: `packages/api/src/routes/terminals.routes.ts`

**Step 1: Import env service**

At top of `terminals.routes.ts`:

```typescript
import { resolveProjectEnv } from '../services/workspace/env.service';
```

**Step 2: Resolve and merge project env before terminal creation**

In the POST `/` handler, after the `env` object is built (around line 70) and before `terminalService.createTerminal()`, add project env resolution. Replace the section that builds `env` and creates the terminal:

Find this block (around lines 70-75):
```typescript
    let env: Record<string, string> = {
      HOME: '/home/agent',
    };
```

Replace with:
```typescript
    // Resolve project-level env vars
    const projectEnv = session.project
      ? await resolveProjectEnv(session.project.id)
      : {};

    let env: Record<string, string> = {
      HOME: '/home/agent',
      ...projectEnv,
    };
```

This ensures project env vars are injected for ALL terminal types (shell, claude, process), but can still be overridden by terminal-specific vars (like HOME for claude).

**Step 3: Verify build**

Run: `bun build packages/api/src/routes/terminals.routes.ts --outdir /tmp/verify --target bun`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add packages/api/src/routes/terminals.routes.ts
git commit -m "feat: inject project env vars into terminal launch"
```

---

### Task 5: Also inject project env into run config start

**Files:**
- Modify: `packages/api/src/services/run-config/run-config.service.ts`

**Step 1: Import env service**

At top of `run-config.service.ts`:

```typescript
import { resolveProjectEnv } from '../workspace/env.service';
```

**Step 2: Add project env to the start method**

In the `start` method (around line 156-160), update the env merging to include project env. Find:

```typescript
    const env: Record<string, string> = {
      HOME: '/home/agent',
      ...resolved.env,
      ...(config.env ? JSON.parse(config.env) : {}),
    };
```

Replace with:

```typescript
    const projectEnv = await resolveProjectEnv(config.projectId);
    const env: Record<string, string> = {
      HOME: '/home/agent',
      ...projectEnv,
      ...resolved.env,
      ...(config.env ? JSON.parse(config.env) : {}),
    };
```

Order: project env < adapter env < run config env (most specific wins).

**Step 3: Verify build**

Run: `bun build packages/api/src/services/run-config/run-config.service.ts --outdir /tmp/verify --target bun`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add packages/api/src/services/run-config/run-config.service.ts
git commit -m "feat: inject project env vars into run config start"
```

---

### Task 6: Add UI API types and methods

**Files:**
- Modify: `packages/ui/src/lib/api.ts`

**Step 1: Add env field to Project interface**

Find the `Project` interface and add `env`:

```typescript
export interface Project {
  id: string;
  name: string;
  description?: string;
  repoUrl?: string;
  localPath: string;
  defaultBranch: string;
  isMultiProject: boolean;
  env?: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
  git?: GitStatus;
  childLinks?: ProjectLink[];
}
```

**Step 2: Add API methods**

Add to the `api` object:

```typescript
  getProjectEnv: (projectId: string) =>
    request<{ env: Record<string, string> }>(`/projects/${projectId}/env`),

  updateProjectEnv: (projectId: string, env: Record<string, string>) =>
    request<{ success: boolean }>(`/projects/${projectId}/env`, {
      method: 'PUT',
      body: JSON.stringify({ env }),
    }),
```

**Step 3: Commit**

```bash
git add packages/ui/src/lib/api.ts
git commit -m "feat(ui): add project env API types and methods"
```

---

### Task 7: Build EnvEditor component

**Files:**
- Create: `packages/ui/src/components/EnvEditor.tsx`

**Step 1: Create the EnvEditor component**

```tsx
import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Plus, Trash2, Save, Loader2 } from 'lucide-react';

interface EnvEntry {
  key: string;
  value: string;
}

export function EnvEditor({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<EnvEntry[]>([]);
  const [isDirty, setIsDirty] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['project-env', projectId],
    queryFn: () => api.getProjectEnv(projectId),
  });

  useEffect(() => {
    if (data?.env) {
      const parsed = Object.entries(data.env).map(([key, value]) => ({ key, value }));
      setEntries(parsed.length > 0 ? parsed : [{ key: '', value: '' }]);
      setIsDirty(false);
    } else {
      setEntries([{ key: '', value: '' }]);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (env: Record<string, string>) => api.updateProjectEnv(projectId, env),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-env', projectId] });
      setIsDirty(false);
    },
  });

  const handleSave = () => {
    const env: Record<string, string> = {};
    for (const entry of entries) {
      const key = entry.key.trim();
      if (key) {
        env[key] = entry.value;
      }
    }
    saveMutation.mutate(env);
  };

  const updateEntry = (index: number, field: 'key' | 'value', val: string) => {
    const next = [...entries];
    next[index] = { ...next[index], [field]: val };
    setEntries(next);
    setIsDirty(true);
  };

  const addEntry = () => {
    setEntries([...entries, { key: '', value: '' }]);
  };

  const removeEntry = (index: number) => {
    const next = entries.filter((_, i) => i !== index);
    setEntries(next.length > 0 ? next : [{ key: '', value: '' }]);
    setIsDirty(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Environment Variables</h3>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={addEntry} className="h-7 px-2 text-xs">
            <Plus className="h-3 w-3 mr-1" /> Add
          </Button>
          <Button
            variant={isDirty ? 'default' : 'ghost'}
            size="sm"
            onClick={handleSave}
            disabled={saveMutation.isPending || !isDirty}
            className="h-7 px-2 text-xs"
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Save className="h-3 w-3 mr-1" />
            )}
            Save
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        {entries.map((entry, i) => (
          <div key={i} className="flex gap-1.5 items-center">
            <Input
              value={entry.key}
              onChange={(e) => updateEntry(i, 'key', e.target.value)}
              placeholder="KEY"
              className="h-8 text-xs font-mono flex-1"
            />
            <span className="text-muted-foreground text-xs">=</span>
            <Input
              value={entry.value}
              onChange={(e) => updateEntry(i, 'value', e.target.value)}
              placeholder="value"
              className="h-8 text-xs font-mono flex-[2]"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeEntry(i)}
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/ui/src/components/EnvEditor.tsx
git commit -m "feat(ui): add EnvEditor component for project env vars"
```

---

### Task 8: Add Env panel to Session page

**Files:**
- Modify: `packages/ui/src/pages/Session.tsx`

**Step 1: Add 'env' to ViewMode type**

Find (line ~32):
```typescript
type ViewMode = 'terminal' | 'git' | 'files' | 'run' | 'preview' | 'docker';
```

Replace with:
```typescript
type ViewMode = 'terminal' | 'git' | 'files' | 'run' | 'preview' | 'docker' | 'env';
```

**Step 2: Add import for EnvEditor**

Add at top with other imports:
```typescript
import { EnvEditor } from '../components/EnvEditor';
```

And add the icon import (add `Settings2` to the lucide-react import):
```typescript
import { ..., Settings2 } from 'lucide-react';
```

**Step 3: Add Env toggle button**

Find the Docker toggle button block and add the Env button before it:

```tsx
{/* Env Toggle */}
{session?.project && (
  <Button
    variant={viewMode === 'env' ? 'secondary' : 'ghost'}
    size="sm"
    className="gap-1.5 h-8 px-2.5 font-mono text-xs"
    onClick={() => setViewMode(viewMode === 'env' ? 'terminal' : 'env')}
  >
    <Settings2 className="h-3.5 w-3.5" />
    <span className="hidden sm:inline">Env</span>
  </Button>
)}
```

**Step 4: Add Env panel rendering**

Find where other panels are conditionally rendered (look for `viewMode === 'docker'` or `viewMode === 'run'`) and add:

```tsx
{viewMode === 'env' && session?.project && (
  <div className="p-4">
    <EnvEditor projectId={session.project.id} />
    {session.project.isMultiProject && session.project.childLinks && (
      <div className="mt-6 space-y-4">
        {session.project.childLinks.map((link: any) => (
          <div key={link.id} className="border rounded-lg p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              {link.alias || link.name}
            </p>
            <EnvEditor projectId={link.id} />
          </div>
        ))}
      </div>
    )}
  </div>
)}
```

**Step 5: Commit**

```bash
git add packages/ui/src/pages/Session.tsx
git commit -m "feat(ui): add Env panel to Session page with multi-project support"
```

---

### Task 9: Final verification

**Step 1: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep -E "env\.service|EnvEditor|terminals\.routes|run-config\.service|projects\.routes|api\.ts"`
Expected: No errors from our files.

**Step 2: Build check**

Run: `bun run build:ui`
Expected: Build succeeds.

**Step 3: Self-review**

Run: `git log --oneline -8`
Verify 8 commits from this feature, all clean.

**Step 4: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix: address any remaining issues from env manager feature"
```
