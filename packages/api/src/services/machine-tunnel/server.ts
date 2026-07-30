import {
  encodeFrame, decodeFrame, bytesToBase64, base64ToBytes,
  serializeHeaders, deserializeHeaders, type Frame, type Bytes,
} from './protocol';

const REQUEST_TIMEOUT_MS = 15_000;
const PONG_TIMEOUT_MS = 45_000;

/** Minimal socket surface — keeps this testable without a real WebSocket. */
export interface TunnelSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface Pending {
  resolve: (res: Response) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Handlers the caller attaches to a tunnelled WS channel. */
export interface TunnelWsHandlers {
  onMessage(data: string | Uint8Array): void;
  onClose(code: number, reason: string): void;
}

export interface TunnelWsChannel {
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

class TunnelConn {
  readonly pending = new Map<string, Pending>();
  readonly channels = new Map<string, TunnelWsHandlers>();
  lastSeenAt = Date.now();
  sessionCount = 0;
  version: string | null = null;

  constructor(readonly machineId: string, readonly socket: TunnelSocket) {}

  send(frame: Frame): void {
    this.socket.send(encodeFrame(frame));
  }

  /**
   * Fail every in-flight request and channel. Without this a dropped tunnel
   * leaks a resolver per request and callers hang until their own timeout.
   */
  teardown(reason: string): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
    for (const [, handlers] of this.channels) {
      handlers.onClose(1011, reason);
    }
    this.channels.clear();
  }
}

class MachineTunnelServer {
  private conns = new Map<string, TunnelConn>();

  /**
   * Register a freshly-authenticated secondary socket. A second connection for
   * the same machine replaces the first (last-writer-wins) — a reconnecting
   * secondary must not be shadowed by a stale half-open socket.
   */
  register(machineId: string, socket: TunnelSocket): TunnelConn {
    const existing = this.conns.get(machineId);
    if (existing && existing.socket !== socket) {
      existing.teardown('Replaced by a newer connection');
      try { existing.socket.close(4000, 'Replaced'); } catch { /* already gone */ }
    }
    const conn = new TunnelConn(machineId, socket);
    this.conns.set(machineId, conn);
    return conn;
  }

  unregister(machineId: string, socket: TunnelSocket): void {
    const conn = this.conns.get(machineId);
    // Guard against a stale close event evicting the newer connection.
    if (!conn || conn.socket !== socket) return;
    conn.teardown('Tunnel closed');
    this.conns.delete(machineId);
  }

  /** The live connection for a machine, only if it still owns `socket`. */
  connection(machineId: string, socket: TunnelSocket): TunnelConn | null {
    const conn = this.conns.get(machineId);
    return conn && conn.socket === socket ? conn : null;
  }

  isOnline(machineId: string): boolean {
    const conn = this.conns.get(machineId);
    if (!conn) return false;
    if (Date.now() - conn.lastSeenAt > PONG_TIMEOUT_MS) return false;
    return true;
  }

  onlineIds(): string[] {
    return [...this.conns.keys()].filter((id) => this.isOnline(id));
  }

  /** Last heartbeat stats reported over the socket, if any. */
  stats(machineId: string): { sessionCount: number; version: string | null } | null {
    const conn = this.conns.get(machineId);
    return conn ? { sessionCount: conn.sessionCount, version: conn.version } : null;
  }

  /** Route an inbound frame from a secondary. */
  handleFrame(conn: TunnelConn, raw: unknown): void {
    const frame = decodeFrame(raw);
    if (!frame) return;
    conn.lastSeenAt = Date.now();

    switch (frame.t) {
      case 'ping':
        conn.send({ t: 'pong' });
        break;
      case 'pong':
        break;
      case 'heartbeat':
        conn.sessionCount = frame.sessionCount;
        conn.version = frame.version ?? null;
        break;
      case 'res': {
        const p = conn.pending.get(frame.id);
        if (!p) return;
        conn.pending.delete(frame.id);
        clearTimeout(p.timer);
        const body = frame.body ? base64ToBytes(frame.body) : null;
        p.resolve(new Response(body, {
          status: frame.status,
          statusText: frame.statusText,
          headers: deserializeHeaders(frame.headers),
        }));
        break;
      }
      case 'err': {
        const p = conn.pending.get(frame.id);
        if (!p) return;
        conn.pending.delete(frame.id);
        clearTimeout(p.timer);
        p.reject(new Error(frame.message));
        break;
      }
      case 'wsready':
        break;
      case 'wsmsg': {
        const handlers = conn.channels.get(frame.id);
        if (!handlers) return;
        handlers.onMessage(frame.binary ? base64ToBytes(frame.data) : frame.data);
        break;
      }
      case 'wsclose': {
        const handlers = conn.channels.get(frame.id);
        if (!handlers) return;
        conn.channels.delete(frame.id);
        handlers.onClose(frame.code ?? 1000, frame.reason ?? '');
        break;
      }
    }
  }

  /** Send a keepalive to every connection and drop the ones that stopped answering. */
  sweep(): void {
    for (const [machineId, conn] of [...this.conns]) {
      if (Date.now() - conn.lastSeenAt > PONG_TIMEOUT_MS) {
        conn.teardown('Tunnel timed out');
        this.conns.delete(machineId);
        try { conn.socket.close(4001, 'Timed out'); } catch { /* already gone */ }
        continue;
      }
      try { conn.send({ t: 'ping' }); } catch { /* dropped, next sweep evicts */ }
    }
  }

  /**
   * Perform an HTTP request on a tunnelled machine. Shaped like `fetch` so the
   * proxy/fan-out call sites can dispatch on transport without restructuring.
   */
  async fetch(
    machineId: string,
    path: string,
    init: {
      method?: string;
      headers?: Headers;
      body?: Bytes | null;
      signal?: AbortSignal;
      timeoutMs?: number;
    } = {},
  ): Promise<Response> {
    const conn = this.conns.get(machineId);
    if (!conn) throw new Error(`Machine ${machineId} is not connected`);

    const id = crypto.randomUUID();
    return new Promise<Response>((resolve, reject) => {
      const settle = (err: Error) => {
        const p = conn.pending.get(id);
        if (!p) return;
        conn.pending.delete(id);
        clearTimeout(p.timer);
        init.signal?.removeEventListener('abort', onAbort);
        reject(err);
      };
      const onAbort = () => settle(new Error('Tunnel request aborted'));

      const timer = setTimeout(
        () => settle(new Error('Tunnel request timed out')),
        init.timeoutMs ?? REQUEST_TIMEOUT_MS,
      );

      conn.pending.set(id, { resolve, reject, timer });

      // Caller gave up (e.g. fan-out timeout) — drop the pending entry now
      // rather than holding a resolver until our own longer timeout fires.
      if (init.signal) {
        if (init.signal.aborted) return onAbort();
        init.signal.addEventListener('abort', onAbort, { once: true });
      }

      try {
        conn.send({
          t: 'req',
          id,
          method: init.method ?? 'GET',
          path,
          headers: init.headers ? serializeHeaders(init.headers) : {},
          body: init.body && init.body.byteLength > 0 ? bytesToBase64(init.body) : undefined,
        });
      } catch (err) {
        conn.pending.delete(id);
        clearTimeout(timer);
        reject(err as Error);
      }
    });
  }

  /** Open a bridged WebSocket channel on a tunnelled machine. */
  openWs(machineId: string, path: string, handlers: TunnelWsHandlers): TunnelWsChannel {
    const conn = this.conns.get(machineId);
    if (!conn) throw new Error(`Machine ${machineId} is not connected`);

    const id = crypto.randomUUID();
    conn.channels.set(id, handlers);
    conn.send({ t: 'wsopen', id, path });

    return {
      send(data) {
        if (!conn.channels.has(id)) return;
        const binary = typeof data !== 'string';
        conn.send({
          t: 'wsmsg',
          id,
          data: binary ? bytesToBase64(data as Uint8Array) : (data as string),
          binary,
        });
      },
      close(code, reason) {
        if (!conn.channels.has(id)) return;
        conn.channels.delete(id);
        try { conn.send({ t: 'wsclose', id, code, reason }); } catch { /* gone */ }
      },
    };
  }
}

export const machineTunnel = new MachineTunnelServer();
