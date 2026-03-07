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

    // Persist to DB — upsert since session may have a stopped editor record
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

    const basePath = `/editor-proxy/${editorId}`;
    const proc = spawn([
      'code-server',
      '--auth', 'none',
      '--bind-addr', `127.0.0.1:${port}`,
      '--base-path', basePath,
      '--idle-timeout-seconds', String(IDLE_TIMEOUT_SECONDS),
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

    // Log stderr for diagnostics
    if (proc.stderr) {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true }).trim();
            if (text) console.error(`[CodeEditorService] Editor ${editorId} stderr: ${text}`);
          }
        } catch { /* stream closed */ }
      })();
    }

    // Handle process exit
    proc.exited.then(async (exitCode) => {
      this.handleExit(editorId, exitCode);
    });

    // Wait for code-server to be ready (poll port)
    this.waitForReady(editorId, port).then(async () => {
      const inst = this.instances.get(editorId);
      if (inst && inst.status === 'starting') {
        inst.status = 'running';
        await db.update(codeEditors)
          .set({ status: 'running' })
          .where(eq(codeEditors.id, editorId));
        this.emit('started', editorId, inst);
      }
    });

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

  private async waitForReady(editorId: string, port: number): Promise<void> {
    const maxAttempts = 30; // 30 seconds max
    for (let i = 0; i < maxAttempts; i++) {
      const instance = this.instances.get(editorId);
      if (!instance || instance.status === 'stopped') return;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/editor-proxy/${editorId}/healthz`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) return;
      } catch {
        // Not ready yet
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    console.warn(`[CodeEditorService] Editor ${editorId} did not become ready in 30s`);
  }

  private async handleExit(editorId: string, exitCode: number): Promise<void> {
    const instance = this.instances.get(editorId);
    if (!instance || instance.status === 'stopped') return;

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
