import { spawn, type Subprocess } from 'bun';

const CODE_SERVER_PORT = parseInt(process.env.CODE_SERVER_PORT || '8080', 10);
const IDLE_TIMEOUT_MS = parseInt(process.env.CODE_SERVER_IDLE_TIMEOUT || '600', 10) * 1000; // default 10 min

type Status = 'stopped' | 'starting' | 'running';

class CodeServerManager {
  private process: Subprocess | null = null;
  private status: Status = 'stopped';
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastActivity = 0;

  getStatus(): Status {
    return this.status;
  }

  /**
   * Ensure code-server is running. Returns once it's ready.
   * Resets the idle timer on every call.
   */
  async ensureRunning(): Promise<void> {
    this.resetIdleTimer();

    if (this.status === 'running') return;

    if (this.status === 'starting') {
      // Wait for the in-progress start
      await this.waitForReady();
      return;
    }

    await this.start();
  }

  private async start(): Promise<void> {
    this.status = 'starting';
    console.log(`[CodeServer] Starting on port ${CODE_SERVER_PORT}...`);

    const proc = spawn([
      'code-server',
      '--auth', 'none',
      '--bind-addr', `0.0.0.0:${CODE_SERVER_PORT}`,
      '--disable-telemetry',
      '--disable-getting-started-override',
      '/app/workspaces',
    ], {
      cwd: '/app/workspaces',
      env: {
        ...process.env,
        HOME: process.env.HOME || '/home/agent',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    this.process = proc;

    // Log stderr
    if (proc.stderr) {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true }).trim();
            if (text) console.error(`[CodeServer] ${text}`);
          }
        } catch { /* stream closed */ }
      })();
    }

    // Handle process exit
    proc.exited.then((exitCode) => {
      console.log(`[CodeServer] Exited with code ${exitCode}`);
      this.process = null;
      this.status = 'stopped';
      this.clearIdleTimer();
    });

    await this.waitForReady();
    if (this.status === 'starting') {
      this.status = 'running';
      console.log(`[CodeServer] Ready on port ${CODE_SERVER_PORT}`);
    }
  }

  private async waitForReady(): Promise<void> {
    for (let i = 0; i < 30; i++) {
      if (this.status === 'stopped') return;
      try {
        const res = await fetch(`http://127.0.0.1:${CODE_SERVER_PORT}/healthz`, {
          signal: AbortSignal.timeout(1000),
        });
        if (res.ok) return;
      } catch {
        // Not ready yet
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    console.warn('[CodeServer] Did not become ready in 30s');
  }

  /** Reset the idle shutdown timer. Call on every user activity. */
  resetIdleTimer(): void {
    this.lastActivity = Date.now();
    this.clearIdleTimer();

    if (this.status === 'stopped') return;

    this.idleTimer = setTimeout(() => {
      console.log(`[CodeServer] Idle for ${IDLE_TIMEOUT_MS / 1000}s, shutting down`);
      this.stop();
    }, IDLE_TIMEOUT_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  async stop(): Promise<void> {
    this.clearIdleTimer();
    if (this.process) {
      console.log('[CodeServer] Stopping...');
      this.process.kill();
      this.process = null;
    }
    this.status = 'stopped';
  }

  async shutdown(): Promise<void> {
    await this.stop();
  }
}

export const codeServerManager = new CodeServerManager();
