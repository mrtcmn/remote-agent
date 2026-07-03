// SSH sessions. An SSH connection is a session (type ssh) owning a terminal
// (type ssh) whose backing is an ssh2 shell stream. Mirrors TerminalService's
// event surface (output/exit/resized) and DB rows so the rest of the app treats
// it like any other session — but owns ssh2, reconnect, and host-key TOFU.
// ponytail: small overlap with TerminalService's scrollback/OSC handling is
// deliberate — reused via copy, not a shared base, to keep the local PTY path untouched.
import { Client, type ClientChannel } from 'ssh2';
import { EventEmitter } from 'node:events';
import { eq, and, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, claudeSessions, terminals, sshHosts, sshCredentials, sshLogEvents } from '../../db';
import { decrypt } from '../crypto/secret-box';

// 1s, 2s, 4s … capped at 30s, up to 10 attempts.
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000];
const MAX_RAW_SCROLLBACK = 1024 * 1024;

type SshStatus = 'connecting' | 'running' | 'exited';
type LogType = 'connect' | 'disconnect' | 'auth_fail' | 'retry' | 'error';

interface SshInstance {
  sessionId: string;
  terminalId: string;
  hostId: string;
  userId: string;
  cols: number;
  rows: number;
  status: SshStatus;
  client: Client | null;
  stream: ClientChannel | null;
  rawScrollback: Uint8Array[];
  userClosed: boolean;
  cleanExit: boolean; // remote shell exited (e.g. user typed `exit`) — do not reconnect
  attempt: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
}

export class SshService extends EventEmitter {
  private instances = new Map<string, SshInstance>();

  /** On boot no ssh2 stream survives — mark ssh terminals exited and their sessions paused. */
  async initialize(): Promise<void> {
    const orphans = await db.query.terminals.findMany({ where: eq(terminals.type, 'ssh') });
    for (const t of orphans) {
      if (t.status === 'running') {
        await db.update(terminals).set({ status: 'exited' }).where(eq(terminals.id, t.id));
        await db.update(claudeSessions).set({ status: 'paused' }).where(eq(claudeSessions.id, t.sessionId));
      }
    }
  }

  /** Create the session + terminal rows and dial. Returns ids for the WS to attach to. */
  async connect(opts: { userId: string; hostId: string; cols?: number; rows?: number }): Promise<{ sessionId: string; terminalId: string }> {
    const host = await db.query.sshHosts.findFirst({ where: eq(sshHosts.id, opts.hostId) });
    if (!host) throw new Error('SSH host not found');
    if (host.userId !== opts.userId) throw new Error('Forbidden');

    const sessionId = nanoid();
    const terminalId = nanoid();
    const cols = opts.cols ?? 80;
    const rows = opts.rows ?? 24;

    await db.insert(claudeSessions).values({
      id: sessionId,
      userId: opts.userId,
      sshHostId: host.id,
      status: 'active',
      lastMessage: `SSH ${host.username}@${host.host}`,
    });
    await db.insert(terminals).values({
      id: terminalId,
      sessionId,
      name: host.label,
      type: 'ssh',
      command: JSON.stringify(['ssh', host.id]),
      cols: String(cols),
      rows: String(rows),
      status: 'running',
    });

    const instance: SshInstance = {
      sessionId, terminalId, hostId: host.id, userId: opts.userId,
      cols, rows, status: 'connecting', client: null, stream: null,
      rawScrollback: [], userClosed: false, cleanExit: false, attempt: 0, retryTimer: null,
    };
    this.instances.set(sessionId, instance);
    this.emit('created', sessionId, instance);
    void this.dial(instance);
    return { sessionId, terminalId };
  }

  private async dial(instance: SshInstance): Promise<void> {
    const host = await db.query.sshHosts.findFirst({ where: eq(sshHosts.id, instance.hostId) });
    if (!host) { await this.fail(instance, 'error', 'Host was deleted'); return; }

    let cred: typeof sshCredentials.$inferSelect | undefined;
    if (host.credentialId) {
      cred = await db.query.sshCredentials.findFirst({ where: eq(sshCredentials.id, host.credentialId) });
    }

    const conn: Record<string, unknown> = {
      host: host.host,
      port: host.port,
      username: host.username,
      readyTimeout: 20000,
      keepaliveInterval: 15000,
      // TOFU host-key check. With hostHash set, ssh2 passes the sha256 hex and a
      // callback — it MUST be called (returning a boolean hangs the handshake).
      hostHash: 'sha256',
      hostVerifier: (hashedKey: string, cb: (ok: boolean) => void) => {
        if (!host.knownHostFp) {
          db.update(sshHosts).set({ knownHostFp: hashedKey }).where(eq(sshHosts.id, host.id))
            .catch((e: unknown) => console.error('[SshService] failed to store host fingerprint', e));
          cb(true); // trust on first use
          return;
        }
        cb(host.knownHostFp === hashedKey); // reject on change (MITM)
      },
    };

    try {
      if (host.authType === 'password') {
        if (!cred?.encPassword) throw new Error('No password credential');
        conn.password = decrypt(Buffer.from(cred.encPassword, 'base64'));
      } else if (host.authType === 'key') {
        if (!cred?.encPrivateKey) throw new Error('No key credential');
        conn.privateKey = decrypt(Buffer.from(cred.encPrivateKey, 'base64'));
        if (cred.encPassphrase) conn.passphrase = decrypt(Buffer.from(cred.encPassphrase, 'base64'));
      } else if (host.authType === 'agent') {
        conn.agent = process.env.SSH_AUTH_SOCK;
        if (!conn.agent) throw new Error('SSH_AUTH_SOCK not set');
      }
    } catch (err) {
      await this.fail(instance, 'error', (err as Error).message);
      return;
    }

    const client = new Client();
    instance.client = client;

    client.on('ready', () => {
      client.shell({ cols: instance.cols, rows: instance.rows, term: 'xterm-256color' }, (err, stream) => {
        if (err) { void this.fail(instance, 'error', err.message); return; }
        instance.stream = stream;
        instance.status = 'running';
        instance.attempt = 0;
        void this.log(instance.hostId, instance.sessionId, 'connect', null);
        this.emit('connected', instance.sessionId, { cols: instance.cols, rows: instance.rows });

        stream.on('data', (data: Buffer) => this.handleOutput(instance, new Uint8Array(data)));
        stream.stderr.on('data', (data: Buffer) => this.handleOutput(instance, new Uint8Array(data)));
        stream.on('exit', () => { instance.cleanExit = true; }); // remote shell ended cleanly
        stream.on('close', () => this.handleDrop(instance));
      });
    });

    client.on('error', (err) => {
      const authFail = /authentication|permission denied|all configured auth/i.test(err.message);
      void this.log(instance.hostId, instance.sessionId, authFail ? 'auth_fail' : 'error', err.message);
      this.emit('log', instance.sessionId, { type: authFail ? 'auth_fail' : 'error', message: err.message });
      // auth/host-key failures are not transient — do not spin reconnect on them.
      if (authFail || /host key|fingerprint|verification/i.test(err.message)) {
        instance.cleanExit = true;
      }
    });

    client.on('close', () => this.handleDrop(instance));

    try {
      client.connect(conn as never);
    } catch (err) {
      await this.fail(instance, 'error', (err as Error).message);
    }
  }

  private handleDrop(instance: SshInstance): void {
    if (instance.status === 'exited') return; // already handled
    if (instance.userClosed || instance.cleanExit) {
      void this.finish(instance, 'disconnect');
      return;
    }
    // Unexpected transport drop → reconnect with backoff.
    if (instance.attempt >= BACKOFF_MS.length) {
      void this.finish(instance, 'error', 'Reconnect attempts exhausted');
      return;
    }
    const delay = BACKOFF_MS[instance.attempt];
    instance.attempt += 1;
    void this.log(instance.hostId, instance.sessionId, 'retry', `attempt ${instance.attempt}`);
    this.emit('reconnecting', instance.sessionId, { attempt: instance.attempt, delayMs: delay });
    instance.client = null;
    instance.stream = null;
    instance.retryTimer = setTimeout(() => { void this.dial(instance); }, delay);
  }

  private handleOutput(instance: SshInstance, data: Uint8Array): void {
    instance.rawScrollback.push(data);
    let total = instance.rawScrollback.reduce((n, c) => n + c.length, 0);
    while (total > MAX_RAW_SCROLLBACK && instance.rawScrollback.length > 1) {
      const removed = instance.rawScrollback.shift();
      if (removed) total -= removed.length;
    }
    this.emit('output', { sessionId: instance.sessionId, data });
  }

  async write(sessionId: string, data: string): Promise<void> {
    const instance = this.instances.get(sessionId);
    if (!instance?.stream) throw new Error('SSH stream not available');
    instance.stream.write(data);
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    const instance = this.instances.get(sessionId);
    if (!instance) return;
    instance.cols = cols;
    instance.rows = rows;
    instance.stream?.setWindow(rows, cols, 0, 0);
    await db.update(terminals).set({ cols: String(cols), rows: String(rows) }).where(eq(terminals.id, instance.terminalId));
    this.emit('resized', sessionId, { cols, rows });
  }

  /** User-initiated close: never reconnects. */
  async close(sessionId: string): Promise<void> {
    const instance = this.instances.get(sessionId);
    if (!instance) return;
    instance.userClosed = true;
    if (instance.retryTimer) clearTimeout(instance.retryTimer);
    instance.stream?.close();
    instance.client?.end();
    await this.finish(instance, 'disconnect');
  }

  getInstance(sessionId: string): SshInstance | undefined {
    return this.instances.get(sessionId);
  }

  getRawScrollback(sessionId: string): Uint8Array | null {
    const instance = this.instances.get(sessionId);
    if (!instance?.rawScrollback.length) return null;
    const total = instance.rawScrollback.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of instance.rawScrollback) { out.set(c, off); off += c.length; }
    return out;
  }

  private async fail(instance: SshInstance, type: LogType, message: string): Promise<void> {
    void this.log(instance.hostId, instance.sessionId, type, message);
    this.emit('log', instance.sessionId, { type, message });
    // Auth/config failures are terminal — mark clean so handleDrop won't retry.
    instance.cleanExit = true;
    await this.finish(instance, type, message);
  }

  private async finish(instance: SshInstance, type: LogType, message?: string): Promise<void> {
    if (instance.status === 'exited') return;
    instance.status = 'exited';
    if (instance.retryTimer) clearTimeout(instance.retryTimer);
    await db.update(terminals).set({ status: 'exited' }).where(eq(terminals.id, instance.terminalId));
    await db.update(claudeSessions).set({ status: 'terminated' }).where(eq(claudeSessions.id, instance.sessionId));
    void this.log(instance.hostId, instance.sessionId, type === 'retry' ? 'disconnect' : type, message ?? null);
    this.emit('exit', instance.sessionId, { message: message ?? null });
    this.instances.delete(instance.sessionId);
  }

  private async log(hostId: string, sessionId: string, type: LogType, message: string | null): Promise<void> {
    await db.insert(sshLogEvents).values({ id: nanoid(), hostId, sessionId, type, message }).catch(() => {});
  }

  async getLogs(hostId: string, limit = 100) {
    return db.query.sshLogEvents.findMany({
      where: eq(sshLogEvents.hostId, hostId),
      orderBy: [desc(sshLogEvents.createdAt)],
      limit,
    });
  }
}

export const sshService = new SshService();
