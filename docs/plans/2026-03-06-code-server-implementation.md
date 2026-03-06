# Code-Server Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add on-demand VS Code editor (code-server) to sessions, spawned per-session with idle timeout, proxied through the API, displayed in an iframe.

**Architecture:** New `CodeEditorService` manages code-server processes (spawn/kill/track). New `codeEditors` DB table persists state. New Elysia routes handle CRUD + reverse proxy (HTTP + WebSocket). UI adds "Editor" view mode tab to Session page.

**Tech Stack:** Elysia (API framework), Drizzle ORM (PostgreSQL), Bun.spawn (process management), React + TanStack Query (UI), code-server (pre-installed binary)

---

### Task 1: Database Schema — Add `codeEditors` Table

**Files:**
- Modify: `packages/api/src/db/schema.ts`

**Step 1: Add enum and table to schema**

Add after the `terminals` table definition (around line 205), before the kanban section:

```typescript
// Code editor status enum
export const codeEditorStatusEnum = pgEnum('code_editor_status', ['starting', 'running', 'stopped']);

// Code editors (code-server instances per session)
export const codeEditors = pgTable('code_editors', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => claudeSessions.id, { onDelete: 'cascade' }).notNull().unique(),
  port: integer('port').notNull(),
  status: codeEditorStatusEnum('status').notNull().default('starting'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  stoppedAt: timestamp('stopped_at'),
});
```

**Step 2: Add relations**

Add after `terminalsRelations` (around line 500):

```typescript
export const codeEditorsRelations = relations(codeEditors, ({ one }) => ({
  session: one(claudeSessions, {
    fields: [codeEditors.sessionId],
    references: [claudeSessions.id],
  }),
}));
```

Add `codeEditors: many(codeEditors)` to `claudeSessionsRelations`.

**Step 3: Add type exports**

Add at the end of the type exports section:

```typescript
export type CodeEditor = typeof codeEditors.$inferSelect;
export type NewCodeEditor = typeof codeEditors.$inferInsert;
```

**Step 4: Export from db/index.ts**

The `db/index.ts` uses `export * from './schema'` so this is automatic.

**Step 5: Generate and run migration**

Run: `cd packages/api && bun run db:generate`

This creates a new migration SQL file in `drizzle/`.

Run: `cd packages/api && bun run db:migrate`

**Step 6: Commit**

```bash
git add packages/api/src/db/schema.ts packages/api/drizzle/
git commit -m "feat: add codeEditors table for code-server instances"
```

---

### Task 2: CodeEditorService — Core Service

**Files:**
- Create: `packages/api/src/services/code-editor/types.ts`
- Create: `packages/api/src/services/code-editor/code-editor.service.ts`
- Create: `packages/api/src/services/code-editor/index.ts`

**Step 1: Create types file**

Create `packages/api/src/services/code-editor/types.ts`:

```typescript
import type { Subprocess } from 'bun';

export type CodeEditorStatus = 'starting' | 'running' | 'stopped';

export interface EditorInstance {
  id: string;
  sessionId: string;
  port: number;
  status: CodeEditorStatus;
  process: Subprocess | null;
  projectPath: string;
  createdAt: Date;
}

export interface StartEditorOptions {
  editorId: string;
  sessionId: string;
  projectPath: string;
}
```

**Step 2: Create the service**

Create `packages/api/src/services/code-editor/code-editor.service.ts`:

```typescript
import { spawn } from 'bun';
import { EventEmitter } from 'events';
import { eq } from 'drizzle-orm';
import { db, codeEditors } from '../../db';
import type { EditorInstance, StartEditorOptions, CodeEditorStatus } from './types';

const PORT_RANGE_START = 13000;
const PORT_RANGE_END = 13100;
const IDLE_TIMEOUT_SECONDS = 600; // 10 minutes

export class CodeEditorService extends EventEmitter {
  private instances = new Map<string, EditorInstance>();

  async initialize(): Promise<void> {
    console.log('[CodeEditorService] Reconciling orphaned editors...');
    await db.update(codeEditors)
      .set({ status: 'stopped', stoppedAt: new Date() })
      .where(eq(codeEditors.status, 'running'));
    await db.update(codeEditors)
      .set({ status: 'stopped', stoppedAt: new Date() })
      .where(eq(codeEditors.status, 'starting'));
    console.log('[CodeEditorService] Orphan reconciliation complete');
  }

  async startEditor(opts: StartEditorOptions): Promise<EditorInstance> {
    const { editorId, sessionId, projectPath } = opts;

    // Check if session already has an editor
    const existing = this.getEditorBySession(sessionId);
    if (existing && existing.status !== 'stopped') {
      return existing;
    }

    const port = await this.allocatePort();

    const instance: EditorInstance = {
      id: editorId,
      sessionId,
      port,
      status: 'starting',
      process: null,
      projectPath,
      createdAt: new Date(),
    };
    this.instances.set(editorId, instance);

    // Persist to DB
    await db.insert(codeEditors).values({
      id: editorId,
      sessionId,
      port,
      status: 'starting',
    }).onConflictDoUpdate({
      target: codeEditors.sessionId,
      set: {
        id: editorId,
        port,
        status: 'starting',
        stoppedAt: null,
        createdAt: new Date(),
      },
    });

    const proc = spawn([
      'code-server',
      '--auth', 'none',
      '--bind-addr', `127.0.0.1:${port}`,
      '--idle-timeout', String(IDLE_TIMEOUT_SECONDS),
      '--disable-telemetry',
      projectPath,
    ], {
      cwd: projectPath,
      env: {
        ...process.env,
        HOME: process.env.HOME || '/home/agent',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    instance.process = proc;
    instance.status = 'running';

    await db.update(codeEditors)
      .set({ status: 'running' })
      .where(eq(codeEditors.id, editorId));

    // Handle process exit
    proc.exited.then(async (exitCode) => {
      this.handleExit(editorId, exitCode);
    });

    this.emit('started', editorId, instance);
    return instance;
  }

  async stopEditor(editorId: string): Promise<void> {
    const instance = this.instances.get(editorId);
    if (!instance) return;

    if (instance.process) {
      instance.process.kill();
    }

    instance.status = 'stopped';
    this.instances.delete(editorId);

    await db.update(codeEditors)
      .set({ status: 'stopped', stoppedAt: new Date() })
      .where(eq(codeEditors.id, editorId));

    this.emit('stopped', editorId);
  }

  async stopSessionEditor(sessionId: string): Promise<void> {
    const instance = this.getEditorBySession(sessionId);
    if (instance) {
      await this.stopEditor(instance.id);
    }
  }

  getEditor(editorId: string): EditorInstance | undefined {
    return this.instances.get(editorId);
  }

  getEditorBySession(sessionId: string): EditorInstance | undefined {
    return Array.from(this.instances.values())
      .find(e => e.sessionId === sessionId);
  }

  async shutdown(): Promise<void> {
    console.log('[CodeEditorService] Shutting down all editors...');
    const allEditors = Array.from(this.instances.keys());
    for (const id of allEditors) {
      await this.stopEditor(id);
    }
  }

  private async handleExit(editorId: string, exitCode: number): Promise<void> {
    const instance = this.instances.get(editorId);
    if (!instance) return;

    console.log(`[CodeEditorService] Editor ${editorId} exited with code ${exitCode}`);
    instance.status = 'stopped';
    this.instances.delete(editorId);

    await db.update(codeEditors)
      .set({ status: 'stopped', stoppedAt: new Date() })
      .where(eq(codeEditors.id, editorId));

    this.emit('stopped', editorId, { exitCode });
  }

  private async allocatePort(): Promise<number> {
    const usedPorts = new Set(
      Array.from(this.instances.values()).map(e => e.port)
    );

    for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
      if (!usedPorts.has(port)) {
        // Check if port is actually free
        const isFree = await this.isPortFree(port);
        if (isFree) return port;
      }
    }

    throw new Error('No free ports available for code-server');
  }

  private async isPortFree(port: number): Promise<boolean> {
    try {
      const server = Bun.serve({
        port,
        fetch() { return new Response(); },
      });
      server.stop(true);
      return true;
    } catch {
      return false;
    }
  }
}

export const codeEditorService = new CodeEditorService();
```

**Step 3: Create index.ts barrel**

Create `packages/api/src/services/code-editor/index.ts`:

```typescript
export { codeEditorService, CodeEditorService } from './code-editor.service';
export type { EditorInstance, StartEditorOptions, CodeEditorStatus } from './types';
```

**Step 4: Commit**

```bash
git add packages/api/src/services/code-editor/
git commit -m "feat: add CodeEditorService for code-server lifecycle management"
```

---

### Task 3: API Routes — Editor CRUD

**Files:**
- Create: `packages/api/src/routes/editor.routes.ts`
- Modify: `packages/api/src/routes/index.ts`

**Step 1: Create editor routes**

Create `packages/api/src/routes/editor.routes.ts`:

```typescript
import { Elysia, t } from 'elysia';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { db, claudeSessions, codeEditors } from '../db';
import { codeEditorService } from '../services/code-editor';
import { requireAuth } from '../auth/middleware';

export const editorRoutes = new Elysia({ prefix: '/sessions' })
  .use(requireAuth)

  // Get editor status for a session
  .get('/:id/editor', async ({ user, params, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.id),
        eq(claudeSessions.userId, user!.id)
      ),
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    // Check in-memory first
    const live = codeEditorService.getEditorBySession(params.id);
    if (live) {
      return {
        id: live.id,
        sessionId: live.sessionId,
        port: live.port,
        status: live.status,
        createdAt: live.createdAt.toISOString(),
      };
    }

    // Check DB for stopped editors
    const dbEditor = await db.query.codeEditors.findFirst({
      where: eq(codeEditors.sessionId, params.id),
    });

    if (!dbEditor) {
      return { status: 'none' };
    }

    return {
      id: dbEditor.id,
      sessionId: dbEditor.sessionId,
      port: dbEditor.port,
      status: dbEditor.status,
      createdAt: dbEditor.createdAt?.toISOString(),
      stoppedAt: dbEditor.stoppedAt?.toISOString(),
    };
  }, {
    params: t.Object({ id: t.String() }),
  })

  // Start editor for a session
  .post('/:id/editor', async ({ user, params, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.id),
        eq(claudeSessions.userId, user!.id)
      ),
      with: { project: true },
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    const userWorkspace = `/app/workspaces/${user!.id}`;
    const projectPath = session.project?.localPath || userWorkspace;

    try {
      const editor = await codeEditorService.startEditor({
        editorId: nanoid(),
        sessionId: params.id,
        projectPath,
      });

      return {
        id: editor.id,
        sessionId: editor.sessionId,
        port: editor.port,
        status: editor.status,
        createdAt: editor.createdAt.toISOString(),
      };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({ id: t.String() }),
  })

  // Stop editor for a session
  .delete('/:id/editor', async ({ user, params, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.id),
        eq(claudeSessions.userId, user!.id)
      ),
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    await codeEditorService.stopSessionEditor(params.id);
    return { success: true };
  }, {
    params: t.Object({ id: t.String() }),
  });
```

**Step 2: Register editor routes in `routes/index.ts`**

Add import and `.use(editorRoutes)` to `packages/api/src/routes/index.ts`:

```typescript
import { editorRoutes } from './editor.routes';

// In the Elysia chain, add:
  .use(editorRoutes)
```

**Step 3: Commit**

```bash
git add packages/api/src/routes/editor.routes.ts packages/api/src/routes/index.ts
git commit -m "feat: add editor CRUD routes for code-server management"
```

---

### Task 4: Reverse Proxy Route

**Files:**
- Create: `packages/api/src/routes/editor-proxy.routes.ts`
- Modify: `packages/api/src/index.ts`

**Step 1: Create the proxy route**

Create `packages/api/src/routes/editor-proxy.routes.ts`:

```typescript
import { Elysia } from 'elysia';
import { codeEditorService } from '../services/code-editor';

export const editorProxyRoutes = new Elysia()
  // Proxy all requests to code-server
  .all('/editor-proxy/:editorId/*', async ({ params, request, set }) => {
    const editor = codeEditorService.getEditor(params.editorId);
    if (!editor || editor.status !== 'running') {
      set.status = 502;
      return { error: 'Editor not running' };
    }

    const url = new URL(request.url);
    const proxyPath = url.pathname.replace(`/editor-proxy/${params.editorId}`, '') || '/';
    const targetUrl = `http://127.0.0.1:${editor.port}${proxyPath}${url.search}`;

    try {
      const headers = new Headers(request.headers);
      headers.set('Host', `127.0.0.1:${editor.port}`);
      headers.delete('connection');

      const proxyResponse = await fetch(targetUrl, {
        method: request.method,
        headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
        redirect: 'manual',
      });

      // Forward response headers
      const responseHeaders = new Headers(proxyResponse.headers);
      responseHeaders.delete('transfer-encoding');

      return new Response(proxyResponse.body, {
        status: proxyResponse.status,
        statusText: proxyResponse.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      set.status = 502;
      return { error: 'Failed to proxy to code-server' };
    }
  })

  // WebSocket proxy for code-server
  .ws('/editor-proxy/:editorId/ws', {
    open(ws) {
      const editorId = (ws.data as any).params.editorId;
      const editor = codeEditorService.getEditor(editorId);
      if (!editor || editor.status !== 'running') {
        ws.close(1011, 'Editor not running');
        return;
      }

      // Create upstream WebSocket connection to code-server
      const upstream = new WebSocket(`ws://127.0.0.1:${editor.port}/ws`);

      upstream.addEventListener('message', (event) => {
        try {
          ws.send(event.data);
        } catch { /* client disconnected */ }
      });

      upstream.addEventListener('close', () => {
        ws.close();
      });

      upstream.addEventListener('error', () => {
        ws.close(1011, 'Upstream error');
      });

      // Store upstream ref on ws data for message forwarding
      (ws.data as any)._upstream = upstream;
    },
    message(ws, message) {
      const upstream = (ws.data as any)._upstream as WebSocket | undefined;
      if (upstream && upstream.readyState === WebSocket.OPEN) {
        upstream.send(message);
      }
    },
    close(ws) {
      const upstream = (ws.data as any)._upstream as WebSocket | undefined;
      if (upstream) {
        upstream.close();
      }
    },
  });
```

**Step 2: Register in main server**

Modify `packages/api/src/index.ts`:

- Add import: `import { editorProxyRoutes } from './routes/editor-proxy.routes';`
- Add `codeEditorService` import: `import { codeEditorService } from './services/code-editor';`
- Add `await codeEditorService.initialize();` after terminal service initialization
- Add `.use(editorProxyRoutes)` after the API routes block
- Add `await codeEditorService.shutdown();` to SIGTERM and SIGINT handlers
- Add `Editor proxy` to the startup log

**Step 3: Commit**

```bash
git add packages/api/src/routes/editor-proxy.routes.ts packages/api/src/index.ts
git commit -m "feat: add reverse proxy for code-server HTTP and WebSocket"
```

---

### Task 5: Session Deletion — Kill Editor on Cascade

**Files:**
- Modify: `packages/api/src/routes/sessions.routes.ts`

**Step 1: Import and call stopSessionEditor on delete**

In `packages/api/src/routes/sessions.routes.ts`, add import:

```typescript
import { codeEditorService } from '../services/code-editor';
```

In the `DELETE /:id` handler (around line 592), add before closing terminals:

```typescript
// Stop code-server editor if running
await codeEditorService.stopSessionEditor(params.id);
```

**Step 2: Commit**

```bash
git add packages/api/src/routes/sessions.routes.ts
git commit -m "feat: stop code-server editor on session deletion"
```

---

### Task 6: UI — API Client Methods

**Files:**
- Modify: `packages/ui/src/lib/api.ts`

**Step 1: Add editor types**

Add after the `BrowserPreview` interface (around line 921):

```typescript
// ─── Code Editor Types ──────────────────────────────────────────────────────

export type CodeEditorStatus = 'none' | 'starting' | 'running' | 'stopped';

export interface CodeEditorInfo {
  id?: string;
  sessionId?: string;
  port?: number;
  status: CodeEditorStatus;
  createdAt?: string;
  stoppedAt?: string;
}
```

**Step 2: Add API methods**

Add to the `api` object, after the browser preview methods:

```typescript
  // ─── Code Editor ──────────────────────────────────────────────────────────

  getEditor: (sessionId: string) =>
    request<CodeEditorInfo>(`/sessions/${sessionId}/editor`),
  startEditor: (sessionId: string) =>
    request<CodeEditorInfo>(`/sessions/${sessionId}/editor`, { method: 'POST' }),
  stopEditor: (sessionId: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/editor`, { method: 'DELETE' }),
```

**Step 3: Commit**

```bash
git add packages/ui/src/lib/api.ts
git commit -m "feat: add code editor API client methods"
```

---

### Task 7: UI — Editor View Mode in Session Page

**Files:**
- Modify: `packages/ui/src/pages/Session.tsx`

**Step 1: Update ViewMode type**

Change line 34:

```typescript
type ViewMode = 'terminal' | 'git' | 'files' | 'run' | 'preview' | 'docker' | 'env' | 'editor';
```

**Step 2: Add imports**

Add to lucide-react imports:

```typescript
import { Code2 } from 'lucide-react';
```

Add to api import:

```typescript
import { api, type TerminalType, type CodeEditorInfo } from '@/lib/api';
```

**Step 3: Add editor query and mutations**

After the `startPreviewMutation` (around line 120), add:

```typescript
  const { data: editorInfo, isLoading: editorLoading } = useQuery({
    queryKey: ['editor', id],
    queryFn: () => api.getEditor(id!),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Poll more frequently when starting, stop polling when running
      if (status === 'starting') return 1000;
      if (status === 'running') return 10000;
      return 5000;
    },
    enabled: !!id,
  });

  const startEditorMutation = useMutation({
    mutationFn: () => api.startEditor(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['editor', id] });
      setViewMode('editor');
    },
    onError: (error) => {
      toast({
        title: 'Failed to start editor',
        description: (error as Error).message,
        variant: 'destructive',
      });
    },
  });

  const stopEditorMutation = useMutation({
    mutationFn: () => api.stopEditor(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['editor', id] });
    },
  });
```

**Step 4: Add Editor button to toolbar**

After the Preview button in the toolbar (around line 283), add before the spacer `<div className="flex-1" />`:

```tsx
        {/* Editor Toggle */}
        {session?.project && (
          <Button
            variant={viewMode === 'editor' ? 'secondary' : 'ghost'}
            size="sm"
            className="gap-1.5 h-8 px-2.5 font-mono text-xs"
            onClick={() => {
              if (viewMode === 'editor') {
                setViewMode('terminal');
              } else if (editorInfo?.status === 'running') {
                setViewMode('editor');
              } else {
                startEditorMutation.mutate();
              }
            }}
            disabled={startEditorMutation.isPending}
          >
            {startEditorMutation.isPending ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Code2 className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">Editor</span>
          </Button>
        )}
```

**Step 5: Add Editor view mode rendering**

In the main content area, before the final `else` fallback to FileExplorer (around line 598), add a new condition:

```tsx
            ) : viewMode === 'editor' ? (
              <EditorPanel
                sessionId={id!}
                editorInfo={editorInfo}
                isLoading={editorLoading}
                onStart={() => startEditorMutation.mutate()}
                onStop={() => stopEditorMutation.mutate()}
                isStarting={startEditorMutation.isPending}
              />
```

**Step 6: Add EditorPanel component**

Add at the bottom of Session.tsx, before the final closing of the file:

```tsx
interface EditorPanelProps {
  sessionId: string;
  editorInfo?: CodeEditorInfo;
  isLoading: boolean;
  onStart: () => void;
  onStop: () => void;
  isStarting: boolean;
}

function EditorPanel({ sessionId, editorInfo, isLoading, onStart, onStop, isStarting }: EditorPanelProps) {
  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!editorInfo || editorInfo.status === 'none' || editorInfo.status === 'stopped') {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 to-purple-500/20 blur-xl rounded-full" />
          <div className="relative p-4">
            <Code2 className="h-10 w-10 text-blue-500" />
          </div>
        </div>
        <p className="text-sm font-mono mb-2">
          {editorInfo?.status === 'stopped' ? 'Editor stopped (idle timeout)' : 'VS Code Editor'}
        </p>
        <p className="text-xs text-muted-foreground mb-4">
          Launch a full VS Code editor for this project
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={onStart}
          disabled={isStarting}
          className="gap-2 font-mono"
        >
          {isStarting ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Code2 className="h-4 w-4 text-blue-500" />
          )}
          {editorInfo?.status === 'stopped' ? 'Restart Editor' : 'Start Editor'}
        </Button>
      </div>
    );
  }

  if (editorInfo.status === 'starting') {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
        <RefreshCw className="h-8 w-8 animate-spin text-blue-500 mb-4" />
        <p className="text-sm font-mono">Starting VS Code editor...</p>
      </div>
    );
  }

  // Running — show iframe
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-card/30 shrink-0">
        <Code2 className="h-3.5 w-3.5 text-blue-500" />
        <span className="text-xs font-mono text-muted-foreground">VS Code Editor</span>
        <div className="h-2 w-2 rounded-full bg-green-500" title="Running" />
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs font-mono"
          onClick={onStop}
        >
          <X className="h-3 w-3 mr-1" />
          Stop
        </Button>
      </div>
      <iframe
        src={`/editor-proxy/${editorInfo.id}/`}
        className="flex-1 w-full border-0"
        title="VS Code Editor"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
```

**Step 7: Add Editor button to sidebar**

In the sidebar section, after the Preview button `<div>` (around line 415), add:

```tsx
            {/* Editor Button */}
            {session?.project && (
              <div className="flex flex-col items-center py-2 border-t border-border/50">
                <button
                  onClick={() => {
                    if (viewMode === 'editor') {
                      setViewMode('terminal');
                    } else if (editorInfo?.status === 'running') {
                      setViewMode('editor');
                    } else {
                      startEditorMutation.mutate();
                    }
                  }}
                  className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center transition-all',
                    'hover:bg-accent',
                    viewMode === 'editor' && 'bg-primary text-primary-foreground'
                  )}
                  title="VS Code Editor"
                >
                  <Code2 className="h-4 w-4" />
                </button>
              </div>
            )}
```

**Step 8: Commit**

```bash
git add packages/ui/src/pages/Session.tsx
git commit -m "feat: add Editor view mode with code-server iframe to Session page"
```

---

### Task 8: Integration — Initialize Service & Wire Up

**Files:**
- Modify: `packages/api/src/index.ts`

This task ensures everything is wired together. Check that `index.ts` has:

1. Import: `import { codeEditorService } from './services/code-editor';`
2. Import: `import { editorProxyRoutes } from './routes/editor-proxy.routes';`
3. Init: `await codeEditorService.initialize();` (after terminalService.initialize())
4. Route: `.use(editorProxyRoutes)` (before the static file serving, after `previewWebsocketRoutes`)
5. Shutdown: `await codeEditorService.shutdown();` in both SIGTERM and SIGINT handlers
6. Log: Add `Editor proxy` endpoint to startup log

**Step 1: Verify and commit**

Run: `cd packages/api && bun run tsc --noEmit`

Fix any type errors.

Run: `bun run build`

Fix any build errors.

**Step 2: Commit if any fixes needed**

```bash
git add packages/api/src/index.ts
git commit -m "feat: wire up code editor service initialization and shutdown"
```

---

### Task 9: Manual Testing

**Step 1: Check code-server is installed**

Run: `which code-server` or `code-server --version`

If not installed, install it:
```bash
curl -fsSL https://code-server.dev/install.sh | sh
```

**Step 2: Start the dev server**

Run: `bun run dev`

**Step 3: Test the flow**

1. Open the UI, navigate to a session with a project
2. Click the "Editor" button in the toolbar
3. Verify code-server starts and loads in the iframe
4. Wait 10 minutes (or kill the process manually) to verify stopped state shows restart button
5. Test session deletion cleans up the editor process

**Step 4: Visual verification with agent-browser skill**

Use the agent-browser skill to verify the UI renders correctly:
- Editor button appears in toolbar
- Clicking it shows the loading/starting state
- Once running, the iframe loads code-server
- Stop button works

---

### Task 10: Final Checks & Commit

**Step 1: Run quality checks**

```bash
cd packages/api && bun run tsc --noEmit
bun run build
bun run lint  # if configured
```

**Step 2: Self code review**

```bash
git diff HEAD~8  # review all changes
```

Check for:
- No hardcoded secrets
- No leftover debug code
- Auth middleware applied correctly
- WebSocket proxy handles disconnects
- Port allocation doesn't leak

**Step 3: Final commit if needed**

Fix any issues found in review.
