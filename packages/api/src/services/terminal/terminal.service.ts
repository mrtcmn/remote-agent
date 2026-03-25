import { spawn } from 'bun';
import { EventEmitter } from 'events';
import { eq, and } from 'drizzle-orm';
import { db, terminals, claudeSessions } from '../../db';
import { notificationService } from '../notification';
import type {
  TerminalInstance,
  CreateTerminalOptions,
  TerminalOutput,
  TerminalStatus,
} from './types';

const MAX_SCROLLBACK_LINES = 10000;

export class TerminalService extends EventEmitter {
  private instances = new Map<string, TerminalInstance>();

  /**
   * Initialize service and reconcile DB state on startup.
   * All terminals in DB are marked as exited since processes don't survive restart.
   * Sessions with no running terminals are marked as paused.
   */
  async initialize(): Promise<void> {
    console.log('[TerminalService] Reconciling orphaned terminals and sessions...');

    // Mark all "running" terminals as "exited" (they can't be running after restart)
    const result = await db.update(terminals)
      .set({ status: 'exited' })
      .where(eq(terminals.status, 'running'));

    // Mark all "active" or "waiting_input" sessions as "paused"
    // They need to be reactivated by creating new terminals
    await db.update(claudeSessions)
      .set({ status: 'paused' })
      .where(eq(claudeSessions.status, 'active'));

    await db.update(claudeSessions)
      .set({ status: 'paused' })
      .where(eq(claudeSessions.status, 'waiting_input'));

    console.log('[TerminalService] Orphan reconciliation complete');
  }

  async createTerminal(opts: CreateTerminalOptions): Promise<TerminalInstance> {
    const {
      terminalId,
      sessionId,
      name = 'Terminal',
      type = 'shell',
      command,
      cols = 80,
      rows = 24,
      persist = false,
      cwd = process.cwd(),
      env = {},
    } = opts;

    // Create a placeholder instance first so exit/data callbacks can find it
    const instance: TerminalInstance = {
      id: terminalId,
      sessionId,
      name,
      type,
      command,
      cols,
      rows,
      persist,
      status: 'running',
      exitCode: null,
      process: null,
      terminal: null,
      scrollback: [],
      createdAt: new Date(),
    };
    this.instances.set(terminalId, instance);

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

    instance.process = proc;
    instance.terminal = proc.terminal ?? null;

    if (!proc.terminal) {
      console.error(`[TerminalService] PTY allocation failed for terminal ${terminalId}, command: ${JSON.stringify(command)}`);
      console.error(`[TerminalService] proc.pid=${proc.pid}, proc.exitCode=${proc.exitCode}`);
    }

    // Persist to database
    await db.insert(terminals).values({
      id: terminalId,
      sessionId,
      name,
      type,
      command: JSON.stringify(command),
      cols: String(cols),
      rows: String(rows),
      persist,
      status: 'running',
    });

    this.emit('created', terminalId, instance);

    return instance;
  }
  async write(terminalId: string, data: string): Promise<void> {
    const instance = this.instances.get(terminalId);
    if (!instance) {
      throw new Error('Terminal not found');
    }
    if (!instance.terminal) {
      throw new Error(`Terminal PTY not available (status: ${instance.status}, pid: ${instance.process?.pid})`);
    }

    instance.terminal.write(data);
  }

  async resize(terminalId: string, cols: number, rows: number): Promise<void> {
    const instance = this.instances.get(terminalId);
    if (!instance) {
      throw new Error('Terminal not found');
    }
    if (!instance.terminal) {
      throw new Error(`Terminal PTY not available (status: ${instance.status}, pid: ${instance.process?.pid})`);
    }

    instance.terminal.resize(cols, rows);
    instance.cols = cols;
    instance.rows = rows;

    // Update database
    await db.update(terminals)
      .set({ cols: String(cols), rows: String(rows) })
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

  async removeExitedTerminals(sessionId: string): Promise<number> {
    // Close any in-memory instances that are exited
    const exitedInstances = Array.from(this.instances.values())
      .filter(t => t.sessionId === sessionId && t.status === 'exited');

    for (const instance of exitedInstances) {
      this.instances.delete(instance.id);
    }

    // Delete exited terminals from database
    const exited = await db.query.terminals.findMany({
      where: and(
        eq(terminals.sessionId, sessionId),
        eq(terminals.status, 'exited'),
      ),
    });

    for (const t of exited) {
      await db.delete(terminals).where(eq(terminals.id, t.id));
    }

    return exited.length;
  }

  getTerminal(terminalId: string): TerminalInstance | undefined {
    return this.instances.get(terminalId);
  }

  getSessionTerminals(sessionId: string): TerminalInstance[] {
    return Array.from(this.instances.values())
      .filter(t => t.sessionId === sessionId);
  }

  getRawScrollback(terminalId: string): Uint8Array | null {
    const instance = this.instances.get(terminalId);
    if (!instance?.rawScrollback || instance.rawScrollback.length === 0) {
      return null;
    }

    // Concatenate all raw chunks into a single buffer
    const totalLength = instance.rawScrollback.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of instance.rawScrollback) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return combined;
  }

  private handleOutput(terminalId: string, data: Uint8Array): void {
    const instance = this.instances.get(terminalId);
    if (!instance) return;

    // Always store raw output in scrollback for session restore
    // Store as raw bytes to preserve ANSI sequences
    if (!instance.rawScrollback) {
      instance.rawScrollback = [];
    }
    instance.rawScrollback.push(data);

    // Trim raw scrollback to limit memory usage (keep last ~1MB)
    let totalSize = 0;
    for (const chunk of instance.rawScrollback) {
      totalSize += chunk.length;
    }
    while (totalSize > 1024 * 1024 && instance.rawScrollback.length > 1) {
      const removed = instance.rawScrollback.shift();
      if (removed) totalSize -= removed.length;
    }

    // Also maintain text scrollback for persistence
    if (instance.persist) {
      const text = new TextDecoder().decode(data);
      const lines = text.split('\n');
      instance.scrollback.push(...lines);

      // Trim scrollback to max lines
      if (instance.scrollback.length > MAX_SCROLLBACK_LINES) {
        instance.scrollback = instance.scrollback.slice(-MAX_SCROLLBACK_LINES);
      }
    }

    // Parse OSC title sequences
    this.parseTitle(terminalId, data);

    const output: TerminalOutput = {
      terminalId,
      data,
      timestamp: new Date(),
    };

    this.emit('output', output);
  }

  /**
   * Parse OSC title escape sequences from terminal output.
   * Handles: \x1b]0;title\x07, \x1b]2;title\x07, \x1b]0;title\x1b\\
   * Buffers partial sequences across chunks.
   */
  private parseTitle(terminalId: string, data: Uint8Array): void {
    const instance = this.instances.get(terminalId);
    if (!instance) return;

    const text = new TextDecoder().decode(data);
    const combined = (instance.titleBuffer || '') + text;

    // Match OSC title sequences: ESC ] 0; title BEL  or  ESC ] 0; title ESC \
    const oscRegex = /\x1b\](?:0|2);([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;
    let match: RegExpExecArray | null;
    let lastTitle: string | null = null;

    while ((match = oscRegex.exec(combined)) !== null) {
      lastTitle = match[1];
    }

    // Check if there's an incomplete OSC sequence at the end
    const partialMatch = combined.match(/\x1b\](?:0|2);[^\x07\x1b]*$/);
    instance.titleBuffer = partialMatch ? partialMatch[0] : undefined;

    // Update name if we found a new non-empty title
    if (lastTitle !== null && lastTitle.length > 0 && lastTitle !== instance.name) {
      instance.name = lastTitle;
      // Update DB (fire-and-forget)
      void db.update(terminals)
        .set({ name: lastTitle })
        .where(eq(terminals.id, terminalId))
        .then(() => {})
        .catch(err => console.error('[TerminalService] Failed to update terminal name:', err));

      this.emit('title_changed', terminalId, lastTitle);
    }
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
      exitCode: String(exitCode),
    };

    if (instance.persist && instance.scrollback.length > 0) {
      updateData.scrollback = instance.scrollback.join('\n');
    }

    await db.update(terminals)
      .set(updateData)
      .where(eq(terminals.id, terminalId));

    // Dismiss pending notifications for this terminal
    await notificationService.dismissByTerminal(terminalId);

    this.emit('exit', terminalId, { exitCode, signal });
  }
}

export const terminalService = new TerminalService();
