// SSH terminals. An SSH connection is a terminal (type ssh) whose backing is an
// ssh2 shell stream. It lives either in its own session (opened from the SSH
// sidebar) or as one more tab in any session, beside shells and agents. Mirrors TerminalService's
// event surface (output/exit/resized) and DB rows so the rest of the app treats
// it like any other session — but owns ssh2, reconnect, and host-key TOFU.
// ponytail: small overlap with TerminalService's scrollback/OSC handling is
// deliberate — reused via copy, not a shared base, to keep the local PTY path untouched.
//
// Two ways in:
//  - interactive terminals (connect/resume/write/send/read): a shell the user
//    sees in the app, which agents can also type into through the MCP;
//  - exec: one command on a pooled connection per host, so any session's agent
//    can run commands on a host without a terminal and without the secrets.
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import { EventEmitter } from 'node:events';
import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, claudeSessions, terminals, sshHosts, sshCredentials, sshLogEvents } from '../../db';
import { decrypt } from '../crypto/secret-box';
import { stripAnsi } from '../terminal/strip-ansi';

// 1s, 2s, 4s … then every 30s until the user closes it: a laptop that sleeps
// for an hour should find its shells back when it wakes.
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const MAX_RAW_SCROLLBACK = 1024 * 1024;
// Dead peers are noticed after ~30s instead of the TCP timeout (minutes).
const KEEPALIVE = { keepaliveInterval: 10_000, keepaliveCountMax: 3, readyTimeout: 20_000 };
const POOL_IDLE_MS = 10 * 60_000;
const EXEC_OUTPUT_CAP = 256 * 1024;

type SshStatus = 'connecting' | 'running' | 'exited';
type LogType = 'connect' | 'disconnect' | 'auth_fail' | 'retry' | 'error';
type Host = typeof sshHosts.$inferSelect;

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
  /** The session exists only for this connection (sidebar SSH): it ends with it. */
  standalone: boolean;
  /** Bumped on every dial and drop; events from an older client are stale. */
  gen: number;
  everConnected: boolean;
}

interface Pooled {
  ready: Promise<Client>;
  client: Client;
  idle: ReturnType<typeof setTimeout> | null;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: string | null;
  timedOut: boolean;
}

const isAuthError = (msg: string) => /authentication|permission denied|all configured auth/i.test(msg);
const isHostKeyError = (msg: string) => /host key|fingerprint|verification/i.test(msg);

export class SshService extends EventEmitter {
  /** By terminal id. */
  private instances = new Map<string, SshInstance>();
  private pool = new Map<string, Pooled>();

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

  private async ownedHost(userId: string, hostId: string): Promise<Host> {
    const host = await db.query.sshHosts.findFirst({ where: eq(sshHosts.id, hostId) });
    if (!host || host.userId !== userId) throw new Error('SSH host not found');
    return host;
  }

  /**
   * ssh2 options for a host: auth from the encrypted vault, keepalive, and the
   * TOFU host-key check. Throws on a config problem (missing credential).
   */
  private async connectConfig(host: Host): Promise<ConnectConfig & { password?: string }> {
    const cred = host.credentialId
      ? await db.query.sshCredentials.findFirst({ where: eq(sshCredentials.id, host.credentialId) })
      : undefined;
    const open = (blob: string) => decrypt(Buffer.from(blob, 'base64'));

    const conn: ConnectConfig & { password?: string } = {
      host: host.host,
      port: host.port,
      username: host.username,
      ...KEEPALIVE,
      // With hostHash set, ssh2 passes the sha256 hex and a callback — it MUST
      // be called (returning a boolean hangs the handshake).
      hostHash: 'sha256',
      hostVerifier: ((hashedKey: string, cb: (ok: boolean) => void) => {
        if (!host.knownHostFp) {
          host.knownHostFp = hashedKey; // the pool and a shell may dial at once
          db.update(sshHosts).set({ knownHostFp: hashedKey }).where(eq(sshHosts.id, host.id))
            .catch((e: unknown) => console.error('[SshService] failed to store host fingerprint', e));
          cb(true); // trust on first use
          return;
        }
        cb(host.knownHostFp === hashedKey); // reject on change (MITM)
      }) as never,
    };

    if (host.authType === 'password') {
      if (!cred?.encPassword) throw new Error('No password credential');
      conn.password = open(cred.encPassword);
      // Many servers turn PasswordAuthentication off but still ask the same
      // password through keyboard-interactive.
      conn.tryKeyboard = true;
    } else if (host.authType === 'key') {
      if (!cred?.encPrivateKey) throw new Error('No key credential');
      conn.privateKey = open(cred.encPrivateKey);
      if (cred.encPassphrase) conn.passphrase = open(cred.encPassphrase);
    } else if (host.authType === 'agent') {
      conn.agent = process.env.SSH_AUTH_SOCK;
      if (!conn.agent) throw new Error('SSH_AUTH_SOCK not set');
    }
    return conn;
  }

  /** Answer keyboard-interactive prompts with the stored password. */
  private static answerPrompts(client: Client, password?: string) {
    client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
      finish(prompts.map(() => password ?? ''));
    });
  }

  // ─── Interactive sessions ────────────────────────────────────────────────

  /**
   * Dial a host into a new terminal: a tab in `sessionId` when given, else a
   * session of its own. Returns ids for the WS to attach to.
   */
  async connect(opts: { userId: string; hostId: string; sessionId?: string; cols?: number; rows?: number }): Promise<{ sessionId: string; terminalId: string }> {
    const host = await this.ownedHost(opts.userId, opts.hostId);

    const standalone = !opts.sessionId;
    const sessionId = opts.sessionId ?? nanoid();
    const terminalId = nanoid();
    const cols = opts.cols ?? 80;
    const rows = opts.rows ?? 24;

    if (standalone) {
      await db.insert(claudeSessions).values({
        id: sessionId,
        userId: opts.userId,
        sshHostId: host.id,
        status: 'active',
        lastMessage: `SSH ${host.username}@${host.host}`,
      });
    } else {
      const session = await db.query.claudeSessions.findFirst({ where: eq(claudeSessions.id, sessionId) });
      if (!session || session.userId !== opts.userId) throw new Error('Session not found');
    }
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

    this.start({ sessionId, terminalId, hostId: host.id, userId: opts.userId, cols, rows, standalone });
    return { sessionId, terminalId };
  }

  /**
   * Dial again into an existing SSH session — after an API restart, a closed
   * connection, or exhausted retries — so it keeps its id, sidebar entry, and
   * scrollback instead of becoming a new session.
   */
  async resume(userId: string, terminalId: string): Promise<{ sessionId: string; terminalId: string }> {
    const live = this.instances.get(terminalId);
    if (live) {
      if (live.userId !== userId) throw new Error('SSH terminal not found');
      return { sessionId: live.sessionId, terminalId };
    }
    const terminal = await db.query.terminals.findFirst({ where: eq(terminals.id, terminalId) });
    const session = terminal && await db.query.claudeSessions.findFirst({ where: eq(claudeSessions.id, terminal.sessionId) });
    if (!terminal || terminal.type !== 'ssh' || !session || session.userId !== userId) throw new Error('SSH terminal not found');
    const hostId = (JSON.parse(terminal.command) as string[])[1];
    await this.ownedHost(userId, hostId);

    await db.update(terminals).set({ status: 'running' }).where(eq(terminals.id, terminalId));
    await db.update(claudeSessions).set({ status: 'active' }).where(eq(claudeSessions.id, session.id));
    this.start({
      sessionId: session.id, terminalId, hostId, userId, standalone: !!session.sshHostId,
      cols: Number(terminal.cols) || 80, rows: Number(terminal.rows) || 24,
    });
    // Open terminals show "reconnecting" until the shell is back.
    this.emit('reconnecting', terminalId, { attempt: 0, delayMs: 0 });
    return { sessionId: session.id, terminalId };
  }

  private start(o: Pick<SshInstance, 'sessionId' | 'terminalId' | 'hostId' | 'userId' | 'cols' | 'rows' | 'standalone'>): void {
    const instance: SshInstance = {
      ...o, status: 'connecting', client: null, stream: null, rawScrollback: [],
      userClosed: false, cleanExit: false, attempt: 0, retryTimer: null, gen: 0, everConnected: false,
    };
    this.instances.set(o.terminalId, instance);
    this.emit('created', o.terminalId, instance);
    void this.dial(instance);
  }

  private async dial(instance: SshInstance): Promise<void> {
    const gen = ++instance.gen;
    const stale = () => instance.gen !== gen || instance.status === 'exited';

    const host = await db.query.sshHosts.findFirst({ where: eq(sshHosts.id, instance.hostId) });
    if (stale()) return;
    if (!host) { await this.fail(instance, 'error', 'Host was deleted'); return; }

    let conn: Awaited<ReturnType<SshService['connectConfig']>>;
    try {
      conn = await this.connectConfig(host);
    } catch (err) {
      await this.fail(instance, 'error', (err as Error).message);
      return;
    }
    if (stale()) return;

    const client = new Client();
    instance.client = client;
    SshService.answerPrompts(client, conn.password);

    client.on('ready', () => {
      if (stale()) { client.end(); return; }
      client.shell({ cols: instance.cols, rows: instance.rows, term: 'xterm-256color' }, (err, stream) => {
        if (stale()) { stream?.close(); client.end(); return; }
        if (err) { void this.fail(instance, 'error', err.message); return; }
        instance.stream = stream;
        instance.status = 'running';
        instance.attempt = 0;
        // A new remote shell after a drop: say so, the old one's state is gone.
        if (instance.everConnected) this.handleOutput(instance, new TextEncoder().encode('\r\n\x1b[2m[reconnected — new shell]\x1b[0m\r\n'));
        instance.everConnected = true;
        void this.log(instance.hostId, instance.sessionId, 'connect', null);
        this.emit('connected', instance.terminalId, { cols: instance.cols, rows: instance.rows });

        stream.on('data', (data: Buffer) => { if (!stale()) this.handleOutput(instance, new Uint8Array(data)); });
        stream.stderr.on('data', (data: Buffer) => { if (!stale()) this.handleOutput(instance, new Uint8Array(data)); });
        stream.on('exit', () => { if (!stale()) instance.cleanExit = true; }); // remote shell ended cleanly
        stream.on('close', () => this.handleDrop(instance, gen));
      });
    });

    client.on('error', (err) => {
      if (stale()) return;
      const type: LogType = isAuthError(err.message) ? 'auth_fail' : 'error';
      void this.log(instance.hostId, instance.sessionId, type, err.message);
      this.emit('log', instance.terminalId, { type, message: err.message });
      // auth/host-key failures are not transient — do not spin reconnect on them.
      if (type === 'auth_fail' || isHostKeyError(err.message)) instance.cleanExit = true;
    });

    client.on('close', () => this.handleDrop(instance, gen));

    try {
      client.connect(conn);
    } catch (err) {
      await this.fail(instance, 'error', (err as Error).message);
    }
  }

  /** Both the shell stream and the client report a drop; only the first counts. */
  private handleDrop(instance: SshInstance, gen: number): void {
    if (instance.gen !== gen || instance.status === 'exited') return;
    instance.gen++; // the rest of this client's events are now stale
    instance.client?.end();
    instance.client = null;
    instance.stream = null;

    if (instance.userClosed || instance.cleanExit) {
      void this.finish(instance, 'disconnect');
      return;
    }
    // A host that never answered is probably wrong (typo, firewall): stop
    // after ~15s instead of retrying it forever.
    if (!instance.everConnected && instance.attempt >= 4) {
      void this.finish(instance, 'error', 'Could not connect');
      return;
    }
    // Unexpected transport drop → reconnect with backoff.
    const delay = BACKOFF_MS[Math.min(instance.attempt, BACKOFF_MS.length - 1)];
    instance.attempt += 1;
    instance.status = 'connecting';
    void this.log(instance.hostId, instance.sessionId, 'retry', `attempt ${instance.attempt}`);
    this.emit('reconnecting', instance.terminalId, { attempt: instance.attempt, delayMs: delay });
    instance.retryTimer = setTimeout(() => { void this.dial(instance); }, delay);
  }

  private handleOutput(instance: SshInstance, data: Uint8Array): void {
    instance.rawScrollback.push(data);
    let total = instance.rawScrollback.reduce((n, c) => n + c.length, 0);
    while (total > MAX_RAW_SCROLLBACK && instance.rawScrollback.length > 1) {
      const removed = instance.rawScrollback.shift();
      if (removed) total -= removed.length;
    }
    this.emit('output', { terminalId: instance.terminalId, data });
  }

  async write(terminalId: string, data: string): Promise<void> {
    const instance = this.instances.get(terminalId);
    if (!instance) throw new Error('SSH terminal is not connected');
    if (!instance.stream) throw new Error('SSH is reconnecting — try again in a moment');
    instance.stream.write(data);
  }

  /**
   * Type into a live shell and return what it printed, as plain text. Waits
   * until the output is quiet for `quietMs`, at most `waitMs`.
   */
  async send(userId: string, terminalId: string, input: string, waitMs = 5000, quietMs = 800): Promise<{ output: string; status: SshStatus }> {
    const instance = this.owned(userId, terminalId);
    const chunks: Uint8Array[] = [];
    const onOutput = (e: { terminalId: string; data: Uint8Array }) => { if (e.terminalId === terminalId) { chunks.push(e.data); bump(); } };
    let quiet: ReturnType<typeof setTimeout> | undefined;
    let done!: () => void;
    const finished = new Promise<void>((r) => { done = r; });
    const bump = () => { clearTimeout(quiet); quiet = setTimeout(done, quietMs); };

    this.on('output', onOutput);
    const cap = setTimeout(done, Math.min(waitMs, 120_000));
    try {
      await this.write(terminalId, input);
      bump();
      await finished;
    } finally {
      clearTimeout(quiet);
      clearTimeout(cap);
      this.off('output', onOutput);
    }
    return { output: SshService.text(chunks).slice(-64 * 1024), status: instance.status };
  }

  /** The last `lines` lines of a terminal's output, as plain text. */
  read(userId: string, terminalId: string, lines = 120): { output: string; status: SshStatus } {
    const instance = this.owned(userId, terminalId);
    const text = SshService.text(instance.rawScrollback);
    return { output: text.split('\n').slice(-lines).join('\n'), status: instance.status };
  }

  private static text(chunks: Uint8Array[]): string {
    return stripAnsi(Buffer.concat(chunks).toString('utf8'));
  }

  private owned(userId: string, terminalId: string): SshInstance {
    const instance = this.instances.get(terminalId);
    if (!instance || instance.userId !== userId) throw new Error('SSH terminal is not connected');
    return instance;
  }

  async resize(terminalId: string, cols: number, rows: number): Promise<void> {
    const instance = this.instances.get(terminalId);
    if (!instance) return;
    instance.cols = cols;
    instance.rows = rows;
    instance.stream?.setWindow(rows, cols, 0, 0);
    await db.update(terminals).set({ cols: String(cols), rows: String(rows) }).where(eq(terminals.id, instance.terminalId));
    this.emit('resized', terminalId, { cols, rows });
  }

  /**
   * User-initiated close: hang up and remove the tab. An SSH terminal that ended
   * any other way keeps its row (status exited), so its tab offers Reconnect.
   */
  async close(terminalId: string): Promise<void> {
    const instance = this.instances.get(terminalId);
    if (instance) {
      instance.userClosed = true;
      instance.gen++;
      if (instance.retryTimer) clearTimeout(instance.retryTimer);
      instance.stream?.close();
      instance.client?.end();
      await this.finish(instance, 'disconnect');
    }
    await db.delete(terminals).where(eq(terminals.id, terminalId));
  }

  /** Hang up every SSH tab of a session, e.g. when the session is deleted. */
  async closeSession(sessionId: string): Promise<void> {
    for (const i of [...this.instances.values()]) if (i.sessionId === sessionId) await this.close(i.terminalId);
  }

  getInstance(terminalId: string): SshInstance | undefined {
    return this.instances.get(terminalId);
  }

  /** Live SSH terminals for a user — lets the UI reattach instead of redialing. */
  listActive(userId: string): Array<{ sessionId: string; terminalId: string; hostId: string; status: SshStatus; standalone: boolean }> {
    return [...this.instances.values()]
      .filter((i) => i.userId === userId)
      .map((i) => ({ sessionId: i.sessionId, terminalId: i.terminalId, hostId: i.hostId, status: i.status, standalone: i.standalone }));
  }

  getRawScrollback(terminalId: string): Uint8Array | null {
    const instance = this.instances.get(terminalId);
    if (!instance?.rawScrollback.length) return null;
    return Buffer.concat(instance.rawScrollback);
  }

  private async fail(instance: SshInstance, type: LogType, message: string): Promise<void> {
    void this.log(instance.hostId, instance.sessionId, type, message);
    this.emit('log', instance.terminalId, { type, message });
    // Auth/config failures are terminal — mark clean so handleDrop won't retry.
    instance.cleanExit = true;
    await this.finish(instance, type, message);
  }

  private async finish(instance: SshInstance, type: LogType, message?: string): Promise<void> {
    if (instance.status === 'exited') return;
    instance.status = 'exited';
    instance.gen++;
    if (instance.retryTimer) clearTimeout(instance.retryTimer);
    instance.client?.end();
    await db.update(terminals).set({ status: 'exited' }).where(eq(terminals.id, instance.terminalId));
    // A tab in another session must not end that session.
    if (instance.standalone) await db.update(claudeSessions).set({ status: 'terminated' }).where(eq(claudeSessions.id, instance.sessionId));
    void this.log(instance.hostId, instance.sessionId, type === 'retry' ? 'disconnect' : type, message ?? null);
    this.emit('exit', instance.terminalId, { message: message ?? null });
    this.instances.delete(instance.terminalId);
  }

  // ─── Exec on a shared connection ─────────────────────────────────────────

  /**
   * Run one command on a host and collect its output. Every caller (any
   * session's agent through the MCP) shares one connection per host; it closes
   * after POOL_IDLE_MS without use.
   */
  async exec(userId: string, hostId: string, command: string, timeoutMs = 60_000): Promise<ExecResult> {
    const host = await this.ownedHost(userId, hostId);
    try {
      return await this.execOnce(host, command, timeoutMs);
    } catch (err) {
      // A pooled connection can die quietly between uses; one fresh dial.
      const message = (err as Error).message;
      if (isAuthError(message) || isHostKeyError(message) || /timed out/i.test(message)) throw err;
      this.dropPooled(host.id);
      return this.execOnce(host, command, timeoutMs);
    }
  }

  private async execOnce(host: Host, command: string, timeoutMs: number): Promise<ExecResult> {
    const client = await this.pooled(host);
    const entry = this.pool.get(host.id);
    if (entry?.idle) clearTimeout(entry.idle);

    try {
      return await new Promise<ExecResult>((resolve, reject) => {
        client.exec(command, (err, stream) => {
          if (err) return reject(err);
          let stdout = '';
          let stderr = '';
          let timedOut = false;
          const keepTail = (buf: string) => (buf.length > EXEC_OUTPUT_CAP ? buf.slice(-EXEC_OUTPUT_CAP) : buf);
          const timer = setTimeout(() => { timedOut = true; stream.signal('KILL'); stream.close(); }, timeoutMs);
          stream.on('data', (d: Buffer) => { stdout = keepTail(stdout + d.toString('utf8')); });
          stream.stderr.on('data', (d: Buffer) => { stderr = keepTail(stderr + d.toString('utf8')); });
          stream.on('close', (code: number | null, signal: string | null) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, code: code ?? null, signal: signal ?? null, timedOut });
          });
        });
      });
    } finally {
      const still = this.pool.get(host.id);
      if (still) still.idle = setTimeout(() => this.dropPooled(host.id), POOL_IDLE_MS);
    }
  }

  private pooled(host: Host): Promise<Client> {
    const hit = this.pool.get(host.id);
    if (hit) return hit.ready;

    const client = new Client();
    const ready = (async () => {
      const conn = await this.connectConfig(host);
      SshService.answerPrompts(client, conn.password);
      return new Promise<Client>((resolve, reject) => {
        client.once('ready', () => resolve(client));
        client.once('error', reject);
        client.connect(conn);
      });
    })();
    const entry: Pooled = { ready, client, idle: null };
    this.pool.set(host.id, entry);
    client.on('error', () => {}); // after ready: the close below cleans up
    client.on('close', () => { if (this.pool.get(host.id) === entry) this.pool.delete(host.id); });
    ready.catch(() => this.dropPooled(host.id));
    return ready;
  }

  /** Close the host's exec connection, e.g. after its address or credential changed. */
  dropPooled(hostId: string): void {
    const entry = this.pool.get(hostId);
    if (!entry) return;
    this.pool.delete(hostId);
    if (entry.idle) clearTimeout(entry.idle);
    entry.client.end();
  }

  /** Hosts with a warm exec connection. */
  pooledHostIds(): string[] {
    return [...this.pool.keys()];
  }

  // ─── Logs ────────────────────────────────────────────────────────────────

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
