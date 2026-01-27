import { spawn, type Subprocess } from 'bun';
import { EventEmitter } from 'events';
import { eq } from 'drizzle-orm';
import { db, claudeSessions } from '../../db';
import { notificationService } from '../notification';
import type { ClaudeSession, CreateSessionOptions, ClaudeOutput, SessionStatus, SessionEventHandler } from './types';

export class ClaudeService extends EventEmitter {
  private sessions = new Map<string, ClaudeSession>();
  private outputBuffers = new Map<string, string>();
  private outputHistory = new Map<string, ClaudeOutput[]>();
  private static MAX_HISTORY_SIZE = 1000; // Limit history to prevent memory issues

  async createSession(opts: CreateSessionOptions): Promise<ClaudeSession> {
    console.log(`[Claude] Creating session ${opts.sessionId} for user ${opts.userId}`);
    console.log(`[Claude] Project path: ${opts.projectPath}`);

    const args = [
      'claude',
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json',
    ];

    if (opts.resume) {
      args.push('--resume', opts.resume);
    }

    if (opts.model) {
      args.push('--model', opts.model);
    }

    console.log(`[Claude] Spawning with args:`, args);

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      CLAUDE_SESSION_ID: opts.sessionId,
      HOME: process.env.HOME || '/root',
    };

    if (opts.hooks) {
      env.CLAUDE_CONFIG_DIR = opts.hooks;
    }

    console.log(`[Claude] ANTHROPIC_API_KEY present: ${!!env.ANTHROPIC_API_KEY}`);
    console.log(`[Claude] Working directory: ${opts.projectPath}`);

    const proc = spawn(args, {
      cwd: opts.projectPath,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env,
    });

    console.log(`[Claude] Process spawned, PID: ${proc.pid}`);

    // Check if process is still alive after a short delay
    setTimeout(() => {
      if (proc.exitCode !== null) {
        console.error(`[Claude] Process ${proc.pid} exited immediately with code ${proc.exitCode}`);
      } else {
        console.log(`[Claude] Process ${proc.pid} still running`);
      }
    }, 500);

    const session: ClaudeSession = {
      id: opts.sessionId,
      userId: opts.userId,
      projectPath: opts.projectPath,
      process: proc,
      status: 'starting',
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };

    this.sessions.set(opts.sessionId, session);
    this.outputBuffers.set(opts.sessionId, '');
    this.outputHistory.set(opts.sessionId, []);

    // Start reading output
    this.pipeOutput(session);
    this.pipeStderr(session);

    // Monitor process exit
    proc.exited.then((code) => {
      this.handleProcessExit(session, code);
    });

    // Update status after a short delay
    setTimeout(() => {
      if (session.status === 'starting') {
        this.updateStatus(session.id, 'running');
      }
    }, 1000);

    // Persist to database
    await this.persistSession(session);

    return session;
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
    console.log(`[Claude] sendMessage called for session ${sessionId}: "${message}"`);

    const session = this.sessions.get(sessionId);
    if (!session || !session.process) {
      console.error(`[Claude] Session ${sessionId} not found or no process`);
      throw new Error('Session not found or not running');
    }

    console.log(`[Claude] Session ${sessionId} status: ${session.status}, process exists: ${!!session.process}`);

    if (session.status === 'terminated') {
      console.error(`[Claude] Session ${sessionId} is terminated`);
      throw new Error('Session is terminated');
    }

    const stdin = session.process.stdin;
    if (!stdin) {
      console.error(`[Claude] Session ${sessionId} stdin not available`);
      throw new Error('Session stdin not available');
    }

    // Check if stdin is a WritableStream (not a file descriptor number)
    if (typeof stdin === 'number') {
      console.error(`[Claude] Session ${sessionId} stdin is a file descriptor`);
      throw new Error('Session stdin is a file descriptor, cannot write');
    }

    // Handle both WritableStream and FileSink
    const message_bytes = new TextEncoder().encode(message + '\n');
    console.log(`[Claude] Writing ${message_bytes.length} bytes to session ${sessionId} stdin`);

    if ('getWriter' in stdin) {
      // WritableStream
      const writer = stdin.getWriter();
      await writer.write(message_bytes);
      writer.releaseLock();
      console.log(`[Claude] Written to WritableStream for session ${sessionId}`);
    } else if ('write' in stdin) {
      // FileSink
      await stdin.write(message_bytes);
      console.log(`[Claude] Written to FileSink for session ${sessionId}`);
    } else {
      console.error(`[Claude] Unknown stdin type for session ${sessionId}`);
      throw new Error('Unknown stdin type');
    }

    session.lastActiveAt = new Date();
    this.updateStatus(sessionId, 'running');
  }

  async respondToInput(sessionId: string, response: string): Promise<void> {
    await this.sendMessage(sessionId, response);
  }

  async terminateSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.process) {
      session.process.kill();
    }

    this.updateStatus(sessionId, 'terminated');
    this.sessions.delete(sessionId);
    this.outputBuffers.delete(sessionId);
    this.outputHistory.delete(sessionId);

    await db.update(claudeSessions)
      .set({ status: 'terminated' })
      .where(eq(claudeSessions.id, sessionId));
  }

  getSession(sessionId: string): ClaudeSession | undefined {
    return this.sessions.get(sessionId);
  }

  getUserSessions(userId: string): ClaudeSession[] {
    return Array.from(this.sessions.values()).filter(s => s.userId === userId);
  }

  getOutputHistory(sessionId: string): ClaudeOutput[] {
    return this.outputHistory.get(sessionId) || [];
  }

  private async pipeOutput(session: ClaudeSession): Promise<void> {
    if (!session.process?.stdout) return;

    const stdout = session.process.stdout;
    // Check if stdout is a ReadableStream (not a file descriptor number)
    if (typeof stdout === 'number') {
      console.error(`Session ${session.id} stdout is a file descriptor, cannot read`);
      return;
    }

    const reader = stdout.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        this.processOutput(session, text);
      }
    } catch (error) {
      console.error(`Error reading stdout for session ${session.id}:`, error);
    }
  }

  private async pipeStderr(session: ClaudeSession): Promise<void> {
    if (!session.process?.stderr) return;

    const stderr = session.process.stderr;
    // Check if stderr is a ReadableStream (not a file descriptor number)
    if (typeof stderr === 'number') {
      console.error(`Session ${session.id} stderr is a file descriptor, cannot read`);
      return;
    }

    const reader = stderr.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        console.error(`[Claude] STDERR from session ${session.id}:`, text);
        this.emitOutput(session.id, {
          type: 'error',
          content: text,
          timestamp: new Date(),
        });
      }
    } catch (error) {
      console.error(`Error reading stderr for session ${session.id}:`, error);
    }
  }

  private processOutput(session: ClaudeSession, text: string): void {
    console.log(`[Claude] Raw stdout from session ${session.id}:`, text.substring(0, 200));

    const buffer = (this.outputBuffers.get(session.id) || '') + text;
    const lines = buffer.split('\n');

    // Keep incomplete line in buffer
    this.outputBuffers.set(session.id, lines.pop() || '');

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const data = JSON.parse(line);
        console.log(`[Claude] Parsed JSON from session ${session.id}:`, data.type || 'unknown type');
        this.handleParsedOutput(session, data);
      } catch {
        // Plain text output
        console.log(`[Claude] Plain text from session ${session.id}:`, line.substring(0, 100));
        this.emitOutput(session.id, {
          type: 'text',
          content: line,
          timestamp: new Date(),
        });
      }
    }
  }

  private handleParsedOutput(session: ClaudeSession, data: Record<string, unknown>): void {
    const type = data.type as string;

    switch (type) {
      case 'assistant':
      case 'text':
        this.emitOutput(session.id, {
          type: 'text',
          content: data.content as string || data.text as string || '',
          timestamp: new Date(),
          metadata: data,
        });
        break;

      case 'tool_use':
        this.emitOutput(session.id, {
          type: 'tool_call',
          content: JSON.stringify(data),
          timestamp: new Date(),
          metadata: data,
        });
        break;

      case 'tool_result':
        this.emitOutput(session.id, {
          type: 'tool_result',
          content: data.output as string || '',
          timestamp: new Date(),
          metadata: data,
        });
        break;

      case 'input_request':
      case 'user_input_request':
        this.handleInputRequest(session, data);
        break;

      case 'permission_request':
        this.handlePermissionRequest(session, data);
        break;

      case 'result':
        if (data.session_id) {
          session.claudeSessionId = data.session_id as string;
        }
        break;

      case 'error':
        this.emitOutput(session.id, {
          type: 'error',
          content: data.error as string || data.message as string || 'Unknown error',
          timestamp: new Date(),
          metadata: data,
        });
        break;

      default:
        this.emitOutput(session.id, {
          type: 'system',
          content: JSON.stringify(data),
          timestamp: new Date(),
          metadata: data,
        });
    }
  }

  private async handleInputRequest(session: ClaudeSession, data: Record<string, unknown>): Promise<void> {
    this.updateStatus(session.id, 'waiting_input');

    const prompt = data.prompt as string || data.message as string || 'Input required';

    this.emitOutput(session.id, {
      type: 'input_request',
      content: prompt,
      timestamp: new Date(),
      metadata: data,
    });

    this.emit('inputRequired', session.id, prompt);

    // Send push notification
    await notificationService.notify(session.userId, {
      sessionId: session.id,
      type: 'user_input_required',
      title: 'Input Required',
      body: prompt.substring(0, 200),
      priority: 'high',
      actions: [
        { label: 'Open Session', action: 'open' },
      ],
    });
  }

  private async handlePermissionRequest(session: ClaudeSession, data: Record<string, unknown>): Promise<void> {
    this.updateStatus(session.id, 'waiting_input');

    const permission = data.permission as string || data.message as string || 'Permission required';

    this.emitOutput(session.id, {
      type: 'permission_request',
      content: permission,
      timestamp: new Date(),
      metadata: data,
    });

    this.emit('permissionRequired', session.id, permission);

    // Send push notification
    await notificationService.notify(session.userId, {
      sessionId: session.id,
      type: 'permission_request',
      title: 'Permission Required',
      body: permission.substring(0, 200),
      priority: 'high',
      actions: [
        { label: 'Allow', action: 'allow' },
        { label: 'Deny', action: 'deny' },
      ],
    });
  }

  private handleProcessExit(session: ClaudeSession, code: number): void {
    console.log(`[Claude] Session ${session.id} process exited with code ${code}`);
    this.updateStatus(session.id, 'terminated');
    this.emit('terminated', session.id, code);

    // Clean up
    this.sessions.delete(session.id);
    this.outputBuffers.delete(session.id);
    this.outputHistory.delete(session.id);

    // Update database
    db.update(claudeSessions)
      .set({ status: 'terminated' })
      .where(eq(claudeSessions.id, session.id));
  }

  private updateStatus(sessionId: string, status: SessionStatus): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
      this.emit('statusChange', sessionId, status);
    }
  }

  private emitOutput(sessionId: string, output: ClaudeOutput): void {
    // Store in history
    const history = this.outputHistory.get(sessionId);
    if (history) {
      history.push(output);
      // Trim history if it exceeds max size
      if (history.length > ClaudeService.MAX_HISTORY_SIZE) {
        history.splice(0, history.length - ClaudeService.MAX_HISTORY_SIZE);
      }
    }
    this.emit('output', sessionId, output);
  }

  private async persistSession(session: ClaudeSession): Promise<void> {
    await db.insert(claudeSessions).values({
      id: session.id,
      userId: session.userId,
      claudeSessionId: session.claudeSessionId,
      status: 'active',
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
    }).onConflictDoUpdate({
      target: claudeSessions.id,
      set: {
        status: 'active',
        lastActiveAt: new Date(),
      },
    });
  }
}

// Singleton instance
export const claudeService = new ClaudeService();
