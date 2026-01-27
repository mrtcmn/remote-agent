# PTY Terminal Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add real PTY terminal support with multiple terminals per session, xterm.js frontend, and optional scrollback persistence.

**Architecture:** New `terminals` table linked to sessions (cascade delete). `TerminalService` manages PTY processes via `Bun.spawn({ terminal })`. WebSocket extended with terminal-specific messages. Frontend uses xterm.js with vertical tabs + optional split panes.

**Tech Stack:** Bun.Terminal (native PTY), xterm.js + xterm-addon-fit + xterm-addon-web-links, existing Elysia/Drizzle/React stack.

---

## Task 1: Database Schema - Add Terminals Table

**Files:**
- Modify: `packages/api/src/db/schema.ts`

**Step 1: Add terminals table schema**

Add after the `messages` table definition (around line 124):

```typescript
// Terminals for PTY sessions
export const terminals = sqliteTable('terminals', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => claudeSessions.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull().default('Terminal'),
  command: text('command').notNull(), // JSON array: ["bash"] or ["claude", ...]
  cols: integer('cols').notNull().default(80),
  rows: integer('rows').notNull().default(24),
  persist: integer('persist', { mode: 'boolean' }).notNull().default(false),
  status: text('status', { enum: ['running', 'exited'] }).notNull().default('running'),
  exitCode: integer('exit_code'),
  scrollback: text('scrollback'), // Only populated if persist=true
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});
```

**Step 2: Add terminals relations**

Add after `messagesRelations` (around line 216):

```typescript
export const terminalsRelations = relations(terminals, ({ one }) => ({
  session: one(claudeSessions, {
    fields: [terminals.sessionId],
    references: [claudeSessions.id],
  }),
}));
```

**Step 3: Update claudeSessionsRelations to include terminals**

Modify the existing `claudeSessionsRelations` to add terminals:

```typescript
export const claudeSessionsRelations = relations(claudeSessions, ({ one, many }) => ({
  user: one(user, {
    fields: [claudeSessions.userId],
    references: [user.id],
  }),
  project: one(projects, {
    fields: [claudeSessions.projectId],
    references: [projects.id],
  }),
  messages: many(messages),
  terminals: many(terminals),
}));
```

**Step 4: Add type exports**

Add at end of file:

```typescript
export type Terminal = typeof terminals.$inferSelect;
export type NewTerminal = typeof terminals.$inferInsert;
```

**Step 5: Generate and run migration**

Run: `cd /Users/murat/grasco/remote-agent/packages/api && bun run db:generate && bun run db:migrate`
Expected: Migration files created and applied successfully

**Step 6: Commit**

```bash
git add packages/api/src/db/schema.ts
git commit -m "$(cat <<'EOF'
feat(db): add terminals table for PTY support

- Add terminals table with cascade delete from sessions
- Support optional scrollback persistence
- Track terminal status and exit codes

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Terminal Service - Core PTY Management

**Files:**
- Create: `packages/api/src/services/terminal/types.ts`
- Create: `packages/api/src/services/terminal/terminal.service.ts`
- Create: `packages/api/src/services/terminal/index.ts`
- Modify: `packages/api/src/services/index.ts`

**Step 1: Create terminal types**

Create `packages/api/src/services/terminal/types.ts`:

```typescript
import type { Subprocess, Terminal as BunTerminal } from 'bun';

export type TerminalStatus = 'running' | 'exited';

export interface TerminalInstance {
  id: string;
  sessionId: string;
  name: string;
  command: string[];
  cols: number;
  rows: number;
  persist: boolean;
  status: TerminalStatus;
  exitCode: number | null;
  process: Subprocess | null;
  terminal: BunTerminal | null;
  scrollback: string[];
  createdAt: Date;
}

export interface CreateTerminalOptions {
  terminalId: string;
  sessionId: string;
  name?: string;
  command: string[];
  cols?: number;
  rows?: number;
  persist?: boolean;
  cwd?: string;
  env?: Record<string, string>;
}

export interface TerminalOutput {
  terminalId: string;
  data: Uint8Array;
  timestamp: Date;
}
```

**Step 2: Create terminal service**

Create `packages/api/src/services/terminal/terminal.service.ts`:

```typescript
import { spawn } from 'bun';
import { EventEmitter } from 'events';
import { eq } from 'drizzle-orm';
import { db, terminals } from '../../db';
import type {
  TerminalInstance,
  CreateTerminalOptions,
  TerminalOutput,
  TerminalStatus,
} from './types';

const MAX_SCROLLBACK_LINES = 10000;

export class TerminalService extends EventEmitter {
  private instances = new Map<string, TerminalInstance>();

  async createTerminal(opts: CreateTerminalOptions): Promise<TerminalInstance> {
    const {
      terminalId,
      sessionId,
      name = 'Terminal',
      command,
      cols = 80,
      rows = 24,
      persist = false,
      cwd = process.cwd(),
      env = {},
    } = opts;

    const proc = spawn(command, {
      cwd,
      env: {
        ...process.env,
        ...env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
      terminal: {
        cols,
        rows,
        name: 'xterm-256color',
        data: (terminal, data) => {
          this.handleOutput(terminalId, data);
        },
        exit: (terminal, exitCode, signal) => {
          this.handleExit(terminalId, exitCode, signal);
        },
      },
    });

    const instance: TerminalInstance = {
      id: terminalId,
      sessionId,
      name,
      command,
      cols,
      rows,
      persist,
      status: 'running',
      exitCode: null,
      process: proc,
      terminal: proc.terminal ?? null,
      scrollback: [],
      createdAt: new Date(),
    };

    this.instances.set(terminalId, instance);

    // Persist to database
    await db.insert(terminals).values({
      id: terminalId,
      sessionId,
      name,
      command: JSON.stringify(command),
      cols,
      rows,
      persist,
      status: 'running',
    });

    this.emit('created', terminalId, instance);

    return instance;
  }

  async write(terminalId: string, data: string): Promise<void> {
    const instance = this.instances.get(terminalId);
    if (!instance?.terminal) {
      throw new Error('Terminal not found or not running');
    }

    instance.terminal.write(data);
  }

  async resize(terminalId: string, cols: number, rows: number): Promise<void> {
    const instance = this.instances.get(terminalId);
    if (!instance?.terminal) {
      throw new Error('Terminal not found or not running');
    }

    instance.terminal.resize(cols, rows);
    instance.cols = cols;
    instance.rows = rows;

    // Update database
    await db.update(terminals)
      .set({ cols, rows })
      .where(eq(terminals.id, terminalId));

    this.emit('resized', terminalId, { cols, rows });
  }

  async closeTerminal(terminalId: string): Promise<void> {
    const instance = this.instances.get(terminalId);
    if (!instance) return;

    if (instance.terminal && !instance.terminal.closed) {
      instance.terminal.close();
    }

    if (instance.process) {
      instance.process.kill();
    }

    this.instances.delete(terminalId);

    // Update database
    await db.update(terminals)
      .set({ status: 'exited' })
      .where(eq(terminals.id, terminalId));
  }

  async closeSessionTerminals(sessionId: string): Promise<void> {
    const sessionTerminals = Array.from(this.instances.values())
      .filter(t => t.sessionId === sessionId);

    for (const terminal of sessionTerminals) {
      await this.closeTerminal(terminal.id);
    }
  }

  getTerminal(terminalId: string): TerminalInstance | undefined {
    return this.instances.get(terminalId);
  }

  getSessionTerminals(sessionId: string): TerminalInstance[] {
    return Array.from(this.instances.values())
      .filter(t => t.sessionId === sessionId);
  }

  private handleOutput(terminalId: string, data: Uint8Array): void {
    const instance = this.instances.get(terminalId);
    if (!instance) return;

    // Store in scrollback if persistence enabled
    if (instance.persist) {
      const text = new TextDecoder().decode(data);
      const lines = text.split('\n');
      instance.scrollback.push(...lines);

      // Trim scrollback to max lines
      if (instance.scrollback.length > MAX_SCROLLBACK_LINES) {
        instance.scrollback = instance.scrollback.slice(-MAX_SCROLLBACK_LINES);
      }
    }

    const output: TerminalOutput = {
      terminalId,
      data,
      timestamp: new Date(),
    };

    this.emit('output', output);
  }

  private async handleExit(
    terminalId: string,
    exitCode: number,
    signal: string | null
  ): Promise<void> {
    const instance = this.instances.get(terminalId);
    if (!instance) return;

    instance.status = 'exited';
    instance.exitCode = exitCode;

    // Save scrollback if persistence enabled
    const updateData: Partial<typeof terminals.$inferInsert> = {
      status: 'exited',
      exitCode,
    };

    if (instance.persist && instance.scrollback.length > 0) {
      updateData.scrollback = instance.scrollback.join('\n');
    }

    await db.update(terminals)
      .set(updateData)
      .where(eq(terminals.id, terminalId));

    this.emit('exit', terminalId, { exitCode, signal });
  }
}

export const terminalService = new TerminalService();
```

**Step 3: Create index export**

Create `packages/api/src/services/terminal/index.ts`:

```typescript
export { terminalService, TerminalService } from './terminal.service';
export * from './types';
```

**Step 4: Update services index**

Modify `packages/api/src/services/index.ts` to add:

```typescript
export * from './terminal';
```

**Step 5: Commit**

```bash
git add packages/api/src/services/terminal/
git add packages/api/src/services/index.ts
git commit -m "$(cat <<'EOF'
feat(api): add TerminalService for PTY management

- Create/write/resize/close PTY terminals using Bun.Terminal
- Event-driven output streaming
- Optional scrollback persistence
- Session-scoped terminal cleanup

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Terminal REST API Routes

**Files:**
- Create: `packages/api/src/routes/terminals.routes.ts`
- Modify: `packages/api/src/routes/index.ts`

**Step 1: Create terminal routes**

Create `packages/api/src/routes/terminals.routes.ts`:

```typescript
import { Elysia, t } from 'elysia';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { db, claudeSessions, terminals } from '../db';
import { terminalService } from '../services/terminal';
import { workspaceService } from '../services/workspace';
import { requireAuth } from '../auth/middleware';

export const terminalRoutes = new Elysia({ prefix: '/terminals' })
  .use(requireAuth)

  // List terminals for a session
  .get('/session/:sessionId', async ({ user, params, set }) => {
    // Verify session ownership
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.sessionId),
        eq(claudeSessions.userId, user!.id)
      ),
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    // Get terminals from database
    const dbTerminals = await db.query.terminals.findMany({
      where: eq(terminals.sessionId, params.sessionId),
    });

    // Enrich with live status
    return dbTerminals.map(t => {
      const live = terminalService.getTerminal(t.id);
      return {
        ...t,
        command: JSON.parse(t.command),
        liveStatus: live?.status || t.status,
      };
    });
  }, {
    params: t.Object({
      sessionId: t.String(),
    }),
  })

  // Create terminal
  .post('/', async ({ user, body, set }) => {
    // Verify session ownership
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, body.sessionId),
        eq(claudeSessions.userId, user!.id)
      ),
      with: { project: true },
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    const terminalId = nanoid();
    const cwd = session.project?.localPath || `/app/workspaces/${user!.id}`;

    try {
      const terminal = await terminalService.createTerminal({
        terminalId,
        sessionId: body.sessionId,
        name: body.name,
        command: body.command || ['bash'],
        cols: body.cols,
        rows: body.rows,
        persist: body.persist,
        cwd,
        env: {
          HOME: process.env.HOME || '/root',
        },
      });

      return {
        id: terminal.id,
        sessionId: terminal.sessionId,
        name: terminal.name,
        command: terminal.command,
        cols: terminal.cols,
        rows: terminal.rows,
        persist: terminal.persist,
        status: terminal.status,
      };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    body: t.Object({
      sessionId: t.String(),
      name: t.Optional(t.String()),
      command: t.Optional(t.Array(t.String())),
      cols: t.Optional(t.Number()),
      rows: t.Optional(t.Number()),
      persist: t.Optional(t.Boolean()),
    }),
  })

  // Get terminal
  .get('/:id', async ({ user, params, set }) => {
    const terminal = await db.query.terminals.findFirst({
      where: eq(terminals.id, params.id),
      with: { session: true },
    });

    if (!terminal) {
      set.status = 404;
      return { error: 'Terminal not found' };
    }

    // Verify ownership via session
    if (terminal.session.userId !== user!.id) {
      set.status = 403;
      return { error: 'Forbidden' };
    }

    const live = terminalService.getTerminal(params.id);

    return {
      ...terminal,
      command: JSON.parse(terminal.command),
      liveStatus: live?.status || terminal.status,
    };
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // Resize terminal
  .post('/:id/resize', async ({ user, params, body, set }) => {
    const terminal = await db.query.terminals.findFirst({
      where: eq(terminals.id, params.id),
      with: { session: true },
    });

    if (!terminal) {
      set.status = 404;
      return { error: 'Terminal not found' };
    }

    if (terminal.session.userId !== user!.id) {
      set.status = 403;
      return { error: 'Forbidden' };
    }

    try {
      await terminalService.resize(params.id, body.cols, body.rows);
      return { success: true };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      cols: t.Number(),
      rows: t.Number(),
    }),
  })

  // Close terminal
  .delete('/:id', async ({ user, params, set }) => {
    const terminal = await db.query.terminals.findFirst({
      where: eq(terminals.id, params.id),
      with: { session: true },
    });

    if (!terminal) {
      set.status = 404;
      return { error: 'Terminal not found' };
    }

    if (terminal.session.userId !== user!.id) {
      set.status = 403;
      return { error: 'Forbidden' };
    }

    await terminalService.closeTerminal(params.id);

    return { success: true };
  }, {
    params: t.Object({
      id: t.String(),
    }),
  });
```

**Step 2: Update routes index**

Modify `packages/api/src/routes/index.ts` to import and export terminal routes:

```typescript
export { terminalRoutes } from './terminals.routes';
```

**Step 3: Mount routes in main app**

Check the main `packages/api/src/index.ts` and ensure terminalRoutes is mounted under `/api`.

**Step 4: Commit**

```bash
git add packages/api/src/routes/terminals.routes.ts
git add packages/api/src/routes/index.ts
git commit -m "$(cat <<'EOF'
feat(api): add terminal REST API routes

- POST /api/terminals - create terminal
- GET /api/terminals/session/:id - list session terminals
- GET /api/terminals/:id - get terminal
- POST /api/terminals/:id/resize - resize terminal
- DELETE /api/terminals/:id - close terminal

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Terminal WebSocket Handler

**Files:**
- Create: `packages/api/src/routes/terminal-websocket.ts`
- Modify: `packages/api/src/index.ts`

**Step 1: Create terminal WebSocket handler**

Create `packages/api/src/routes/terminal-websocket.ts`:

```typescript
import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, terminals } from '../db';
import { terminalService } from '../services/terminal';
import type { TerminalOutput } from '../services/terminal/types';

// Store WebSocket connections per terminal
const terminalConnections = new Map<string, Set<{ send: (data: string) => void }>>();

// Subscribe to terminal service events
terminalService.on('output', (output: TerminalOutput) => {
  const connections = terminalConnections.get(output.terminalId);
  if (connections) {
    // Send binary data as base64
    const base64 = Buffer.from(output.data).toString('base64');
    const message = JSON.stringify({
      type: 'output',
      data: base64,
    });
    connections.forEach(ws => ws.send(message));
  }
});

terminalService.on('exit', (terminalId: string, info: { exitCode: number; signal: string | null }) => {
  const connections = terminalConnections.get(terminalId);
  if (connections) {
    const message = JSON.stringify({
      type: 'exit',
      data: info,
    });
    connections.forEach(ws => ws.send(message));
  }
});

terminalService.on('resized', (terminalId: string, size: { cols: number; rows: number }) => {
  const connections = terminalConnections.get(terminalId);
  if (connections) {
    const message = JSON.stringify({
      type: 'resized',
      data: size,
    });
    connections.forEach(ws => ws.send(message));
  }
});

export const terminalWebsocketRoutes = new Elysia()
  .ws('/ws/terminal/:terminalId', {
    body: t.Object({
      type: t.String(),
      data: t.Optional(t.Unknown()),
    }),

    async open(ws) {
      const terminalId = ws.data.params.terminalId;

      // Verify terminal exists
      const terminal = await db.query.terminals.findFirst({
        where: eq(terminals.id, terminalId),
      });

      if (!terminal) {
        ws.send(JSON.stringify({
          type: 'error',
          data: { message: 'Terminal not found' },
        }));
        ws.close();
        return;
      }

      // Add to terminal connections
      if (!terminalConnections.has(terminalId)) {
        terminalConnections.set(terminalId, new Set());
      }
      terminalConnections.get(terminalId)!.add(ws);

      // Send current status
      const live = terminalService.getTerminal(terminalId);
      ws.send(JSON.stringify({
        type: 'connected',
        data: {
          status: live?.status || terminal.status,
          cols: terminal.cols,
          rows: terminal.rows,
        },
      }));

      // If terminal has persisted scrollback, send it
      if (terminal.scrollback) {
        const base64 = Buffer.from(terminal.scrollback).toString('base64');
        ws.send(JSON.stringify({
          type: 'scrollback',
          data: base64,
        }));
      }
    },

    async message(ws, message) {
      const terminalId = ws.data.params.terminalId;
      const { type, data } = message as { type: string; data?: unknown };

      switch (type) {
        case 'input': {
          // Write to terminal (data is base64 encoded)
          const input = Buffer.from(data as string, 'base64').toString();
          try {
            await terminalService.write(terminalId, input);
          } catch (error) {
            ws.send(JSON.stringify({
              type: 'error',
              data: { message: (error as Error).message },
            }));
          }
          break;
        }

        case 'resize': {
          const { cols, rows } = data as { cols: number; rows: number };
          try {
            await terminalService.resize(terminalId, cols, rows);
          } catch (error) {
            ws.send(JSON.stringify({
              type: 'error',
              data: { message: (error as Error).message },
            }));
          }
          break;
        }

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
      }
    },

    close(ws) {
      const terminalId = ws.data.params.terminalId;
      const connections = terminalConnections.get(terminalId);
      if (connections) {
        connections.delete(ws);
        if (connections.size === 0) {
          terminalConnections.delete(terminalId);
        }
      }
    },
  });
```

**Step 2: Mount WebSocket routes in main app**

Modify `packages/api/src/index.ts` to import and use `terminalWebsocketRoutes`:

```typescript
import { terminalWebsocketRoutes } from './routes/terminal-websocket';

// ... in app setup
app.use(terminalWebsocketRoutes);
```

**Step 3: Commit**

```bash
git add packages/api/src/routes/terminal-websocket.ts
git add packages/api/src/index.ts
git commit -m "$(cat <<'EOF'
feat(api): add terminal WebSocket handler

- /ws/terminal/:id for real-time PTY I/O
- Base64 encoding for binary data
- Support input, resize, scrollback restoration
- Broadcast output/exit/resize events

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Frontend - Install xterm.js Dependencies

**Files:**
- Modify: `packages/ui/package.json`

**Step 1: Add xterm.js dependencies**

Run: `cd /Users/murat/grasco/remote-agent/packages/ui && bun add xterm @xterm/addon-fit @xterm/addon-web-links`

**Step 2: Verify installation**

Run: `cd /Users/murat/grasco/remote-agent/packages/ui && bun install`
Expected: Dependencies installed successfully

**Step 3: Commit**

```bash
git add packages/ui/package.json packages/ui/bun.lockb
git commit -m "$(cat <<'EOF'
feat(ui): add xterm.js dependencies

- xterm for terminal emulation
- @xterm/addon-fit for auto-resize
- @xterm/addon-web-links for clickable links

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Frontend - Terminal API Client

**Files:**
- Modify: `packages/ui/src/lib/api.ts`

**Step 1: Add terminal types**

Add to the types section at the bottom of `api.ts`:

```typescript
export interface TerminalInfo {
  id: string;
  sessionId: string;
  name: string;
  command: string[];
  cols: number;
  rows: number;
  persist: boolean;
  status: 'running' | 'exited';
  liveStatus?: string;
  exitCode?: number;
  scrollback?: string;
  createdAt: string;
}

export interface CreateTerminalInput {
  sessionId: string;
  name?: string;
  command?: string[];
  cols?: number;
  rows?: number;
  persist?: boolean;
}
```

**Step 2: Add terminal API methods**

Add to the `api` object:

```typescript
  // Terminals
  getSessionTerminals: (sessionId: string) =>
    request<TerminalInfo[]>(`/terminals/session/${sessionId}`),
  getTerminal: (id: string) =>
    request<TerminalInfo>(`/terminals/${id}`),
  createTerminal: (data: CreateTerminalInput) =>
    request<TerminalInfo>('/terminals', { method: 'POST', body: JSON.stringify(data) }),
  resizeTerminal: (id: string, cols: number, rows: number) =>
    request(`/terminals/${id}/resize`, { method: 'POST', body: JSON.stringify({ cols, rows }) }),
  closeTerminal: (id: string) =>
    request(`/terminals/${id}`, { method: 'DELETE' }),
```

**Step 3: Commit**

```bash
git add packages/ui/src/lib/api.ts
git commit -m "$(cat <<'EOF'
feat(ui): add terminal API client methods

- CRUD operations for terminals
- Type definitions for terminal data

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Frontend - useTerminal Hook

**Files:**
- Create: `packages/ui/src/hooks/useTerminal.ts`

**Step 1: Create useTerminal hook**

Create `packages/ui/src/hooks/useTerminal.ts`:

```typescript
import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import 'xterm/css/xterm.css';

interface UseTerminalOptions {
  terminalId: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onExit?: (exitCode: number) => void;
}

interface UseTerminalReturn {
  terminalRef: React.RefObject<HTMLDivElement>;
  isConnected: boolean;
  status: 'connecting' | 'connected' | 'disconnected' | 'exited';
  fit: () => void;
}

export function useTerminal(options: UseTerminalOptions): UseTerminalReturn {
  const { terminalId, onConnect, onDisconnect, onExit } = options;

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'exited'>('connecting');

  const resizeDebounceRef = useRef<number>();

  const fit = useCallback(() => {
    if (fitAddonRef.current && xtermRef.current) {
      fitAddonRef.current.fit();

      // Send resize to backend (debounced)
      if (resizeDebounceRef.current) {
        clearTimeout(resizeDebounceRef.current);
      }
      resizeDebounceRef.current = window.setTimeout(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN && xtermRef.current) {
          const { cols, rows } = xtermRef.current;
          wsRef.current.send(JSON.stringify({
            type: 'resize',
            data: { cols, rows },
          }));
        }
      }, 100);
    }
  }, []);

  useEffect(() => {
    if (!terminalRef.current || !terminalId) return;

    // Initialize xterm
    const xterm = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1a1a1a',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        cursorAccent: '#1a1a1a',
        selectionBackground: '#264f78',
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    xterm.loadAddon(fitAddon);
    xterm.loadAddon(webLinksAddon);

    xterm.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal/${terminalId}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setIsConnected(true);
      setStatus('connected');
      onConnect?.();

      // Send initial size
      const { cols, rows } = xterm;
      ws.send(JSON.stringify({
        type: 'resize',
        data: { cols, rows },
      }));
    };

    ws.onclose = () => {
      setIsConnected(false);
      if (status !== 'exited') {
        setStatus('disconnected');
      }
      onDisconnect?.();
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        switch (message.type) {
          case 'output': {
            // Decode base64 and write to terminal
            const data = atob(message.data);
            xterm.write(data);
            break;
          }

          case 'scrollback': {
            // Restore scrollback
            const data = atob(message.data);
            xterm.write(data);
            break;
          }

          case 'exit': {
            setStatus('exited');
            xterm.write(`\r\n\x1b[31mProcess exited with code ${message.data.exitCode}\x1b[0m\r\n`);
            onExit?.(message.data.exitCode);
            break;
          }

          case 'connected': {
            // Resize to match server expectations if different
            if (message.data.cols !== xterm.cols || message.data.rows !== xterm.rows) {
              fitAddon.fit();
            }
            break;
          }
        }
      } catch (e) {
        console.error('Failed to parse terminal message:', e);
      }
    };

    wsRef.current = ws;

    // Handle terminal input
    xterm.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        // Encode as base64
        const base64 = btoa(data);
        ws.send(JSON.stringify({
          type: 'input',
          data: base64,
        }));
      }
    });

    // Handle window resize
    const handleResize = () => fit();
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeDebounceRef.current) {
        clearTimeout(resizeDebounceRef.current);
      }
      ws.close();
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
  }, [terminalId, onConnect, onDisconnect, onExit, fit, status]);

  return {
    terminalRef,
    isConnected,
    status,
    fit,
  };
}
```

**Step 2: Commit**

```bash
git add packages/ui/src/hooks/useTerminal.ts
git commit -m "$(cat <<'EOF'
feat(ui): add useTerminal hook

- xterm.js integration with fit addon
- WebSocket connection for real-time I/O
- Base64 encoding for binary data
- Debounced resize handling
- Scrollback restoration

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Frontend - Terminal Component

**Files:**
- Create: `packages/ui/src/components/Terminal.tsx`

**Step 1: Create Terminal component**

Create `packages/ui/src/components/Terminal.tsx`:

```typescript
import { useEffect } from 'react';
import { useTerminal } from '@/hooks/useTerminal';
import { cn } from '@/lib/utils';

interface TerminalProps {
  terminalId: string;
  className?: string;
  onExit?: (exitCode: number) => void;
}

export function Terminal({ terminalId, className, onExit }: TerminalProps) {
  const { terminalRef, isConnected, status, fit } = useTerminal({
    terminalId,
    onExit,
  });

  // Fit terminal when container might have resized
  useEffect(() => {
    const resizeObserver = new ResizeObserver(() => {
      fit();
    });

    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => resizeObserver.disconnect();
  }, [fit, terminalRef]);

  return (
    <div className={cn('relative h-full w-full', className)}>
      {/* Status indicator */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-2 text-xs">
        <div
          className={cn(
            'h-2 w-2 rounded-full',
            status === 'connected' && 'bg-green-500',
            status === 'connecting' && 'bg-yellow-500 animate-pulse',
            status === 'disconnected' && 'bg-red-500',
            status === 'exited' && 'bg-gray-500'
          )}
        />
        <span className="text-muted-foreground capitalize">{status}</span>
      </div>

      {/* Terminal container */}
      <div
        ref={terminalRef}
        className="h-full w-full bg-[#1a1a1a] rounded-lg overflow-hidden"
      />
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/ui/src/components/Terminal.tsx
git commit -m "$(cat <<'EOF'
feat(ui): add Terminal component

- Wrapper for xterm.js with status indicator
- ResizeObserver for auto-fit
- Connection status display

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Frontend - Terminal Tabs Component

**Files:**
- Create: `packages/ui/src/components/TerminalTabs.tsx`

**Step 1: Create TerminalTabs component**

Create `packages/ui/src/components/TerminalTabs.tsx`:

```typescript
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, TerminalSquare, RefreshCw } from 'lucide-react';
import { api, type TerminalInfo } from '@/lib/api';
import { Terminal } from './Terminal';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface TerminalTabsProps {
  sessionId: string;
  className?: string;
}

export function TerminalTabs({ sessionId, className }: TerminalTabsProps) {
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: terminals = [], isLoading } = useQuery({
    queryKey: ['terminals', sessionId],
    queryFn: () => api.getSessionTerminals(sessionId),
    refetchInterval: 5000,
  });

  const createMutation = useMutation({
    mutationFn: () => api.createTerminal({ sessionId }),
    onSuccess: (terminal) => {
      queryClient.invalidateQueries({ queryKey: ['terminals', sessionId] });
      setActiveTerminalId(terminal.id);
    },
  });

  const closeMutation = useMutation({
    mutationFn: (id: string) => api.closeTerminal(id),
    onSuccess: (_, closedId) => {
      queryClient.invalidateQueries({ queryKey: ['terminals', sessionId] });
      if (activeTerminalId === closedId) {
        const remaining = terminals.filter(t => t.id !== closedId);
        setActiveTerminalId(remaining[0]?.id || null);
      }
    },
  });

  // Auto-select first terminal
  if (!activeTerminalId && terminals.length > 0 && !isLoading) {
    setActiveTerminalId(terminals[0].id);
  }

  const activeTerminal = terminals.find(t => t.id === activeTerminalId);

  return (
    <div className={cn('flex h-full', className)}>
      {/* Vertical tabs sidebar */}
      <div className="w-48 border-r bg-muted/30 flex flex-col">
        <div className="p-2 border-b">
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            New Terminal
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {terminals.map((terminal) => (
            <div
              key={terminal.id}
              className={cn(
                'group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors',
                activeTerminalId === terminal.id
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted'
              )}
              onClick={() => setActiveTerminalId(terminal.id)}
            >
              <TerminalSquare className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate text-sm">{terminal.name}</span>
              <div
                className={cn(
                  'h-2 w-2 rounded-full shrink-0',
                  terminal.liveStatus === 'running' ? 'bg-green-500' : 'bg-gray-500'
                )}
              />
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-5 w-5 opacity-0 group-hover:opacity-100',
                  activeTerminalId === terminal.id && 'text-primary-foreground hover:text-primary-foreground'
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  closeMutation.mutate(terminal.id);
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}

          {terminals.length === 0 && !isLoading && (
            <div className="text-center text-muted-foreground text-sm py-8">
              No terminals yet
            </div>
          )}
        </div>
      </div>

      {/* Terminal content */}
      <div className="flex-1 p-4">
        {activeTerminal ? (
          <Terminal
            key={activeTerminal.id}
            terminalId={activeTerminal.id}
            className="h-full"
            onExit={(code) => {
              queryClient.invalidateQueries({ queryKey: ['terminals', sessionId] });
            }}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            {isLoading ? (
              <RefreshCw className="h-6 w-6 animate-spin" />
            ) : (
              <div className="text-center">
                <TerminalSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Create a terminal to get started</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/ui/src/components/TerminalTabs.tsx
git commit -m "$(cat <<'EOF'
feat(ui): add TerminalTabs component

- Vertical tab sidebar for terminal selection
- Create/close terminal functionality
- Status indicators for each terminal
- Auto-select first terminal

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Frontend - Update Session Page

**Files:**
- Modify: `packages/ui/src/pages/Session.tsx`

**Step 1: Update Session page to use TerminalTabs**

Replace the existing Session page content with the new terminal-based UI. The page should show either the existing Claude session output OR terminal tabs based on user preference or session type.

Add import at top:

```typescript
import { TerminalTabs } from '@/components/TerminalTabs';
```

Add a state to toggle between modes and render TerminalTabs:

```typescript
const [viewMode, setViewMode] = useState<'claude' | 'terminal'>('claude');
```

Add a toggle button in the header and conditionally render either the existing output view or the TerminalTabs:

```typescript
{viewMode === 'terminal' ? (
  <TerminalTabs sessionId={id!} className="flex-1" />
) : (
  // existing output/input UI
)}
```

**Step 2: Test the integration**

Run: `cd /Users/murat/grasco/remote-agent && bun run dev`
Expected: Application starts, session page shows terminal tabs toggle

**Step 3: Commit**

```bash
git add packages/ui/src/pages/Session.tsx
git commit -m "$(cat <<'EOF'
feat(ui): integrate terminal tabs into Session page

- Add view mode toggle (claude/terminal)
- Render TerminalTabs component in terminal mode
- Preserve existing Claude session UI

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Integration - Clean Up Session Terminals on Delete

**Files:**
- Modify: `packages/api/src/routes/sessions.routes.ts`

**Step 1: Close terminals when session is deleted**

Import terminal service at top:

```typescript
import { terminalService } from '../services/terminal';
```

Update the DELETE endpoint to close all session terminals:

```typescript
// In the delete handler, before claudeService.terminateSession
await terminalService.closeSessionTerminals(params.id);
```

**Step 2: Commit**

```bash
git add packages/api/src/routes/sessions.routes.ts
git commit -m "$(cat <<'EOF'
fix(api): close terminals when session is deleted

- Clean up PTY processes on session termination
- Prevent orphaned terminal processes

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Final Integration Test

**Step 1: Start the development server**

Run: `cd /Users/murat/grasco/remote-agent && bun run dev`

**Step 2: Test terminal creation flow**

1. Create a new session
2. Switch to terminal view
3. Create a new terminal (should spawn bash)
4. Type commands in the terminal
5. Verify output appears correctly
6. Test resize by resizing browser window
7. Create multiple terminals
8. Switch between tabs
9. Close a terminal
10. Delete the session and verify terminals are cleaned up

**Step 3: Commit final integration**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat: complete PTY terminal support implementation

- Database schema with terminals table
- TerminalService for PTY management via Bun.Terminal
- REST API for terminal CRUD
- WebSocket handler for real-time I/O
- xterm.js frontend with vertical tabs
- Optional scrollback persistence
- Session cleanup integration

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

This plan implements full PTY terminal support with:

1. **Database**: New `terminals` table with cascade delete from sessions
2. **Backend Service**: `TerminalService` using native `Bun.Terminal` API
3. **REST API**: Full CRUD for terminals under `/api/terminals`
4. **WebSocket**: Real-time bidirectional PTY I/O at `/ws/terminal/:id`
5. **Frontend**: xterm.js integration with vertical tabs UI
6. **Cleanup**: Automatic terminal cleanup on session deletion

The implementation follows the existing codebase patterns and integrates cleanly with the current architecture.
