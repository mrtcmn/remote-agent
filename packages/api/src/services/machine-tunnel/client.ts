import {
  encodeFrame, decodeFrame, bytesToBase64, base64ToBytes,
  serializeHeaders, deserializeHeaders, type Frame,
} from './protocol';
import type { PairedMaster } from '../../db/schema';
import { TUNNEL_INTERNAL_SECRET, TUNNEL_AUTH_HEADER, TUNNEL_MACHINE_HEADER } from './internal';

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Serves a Request against this machine's own API (loopback). */
export type LocalDispatch = (request: Request) => Promise<Response>;

interface Deps {
  dispatch: LocalDispatch;
  sessionCount: () => number;
  version: string;
}

/** One tunnel to one master, with its own reconnect loop. */
class MasterTunnel {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private attempts = 0;
  private stopped = false;
  private channels = new Map<string, WebSocket>();

  constructor(private master: PairedMaster, private deps: Deps) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.closeChannels();
    try { this.ws?.close(1000, 'Shutting down'); } catch { /* gone */ }
    this.ws = null;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private url(): string {
    const base = this.master.url.replace(/^http/, 'ws');
    return `${base}/ws/machine-tunnel`;
  }

  private connect(): void {
    if (this.stopped) return;

    let ws: WebSocket;
    try {
      // Bun's WebSocket client supports request headers; the ?token= fallback
      // in the route covers clients that don't.
      ws = new WebSocket(this.url(), {
        headers: { authorization: `Bearer ${this.master.machineToken}` },
      } as unknown as string[]);
    } catch (err) {
      this.scheduleReconnect(`connect failed: ${(err as Error).message}`);
      return;
    }
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.attempts = 0;
      console.log(`[machine-tunnel] connected to ${this.master.name}`);
      this.sendHeartbeat();
      this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
    });

    ws.addEventListener('message', (event) => {
      const frame = decodeFrame(event.data);
      if (frame) this.handleFrame(frame).catch((err) => {
        console.error('[machine-tunnel] frame error:', err);
      });
    });

    ws.addEventListener('close', () => this.scheduleReconnect('closed'));
    ws.addEventListener('error', () => {
      // 'error' is always followed by 'close'; let close drive the retry.
    });
  }

  private scheduleReconnect(reason: string): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.closeChannels();
    this.ws = null;
    if (this.stopped || this.reconnectTimer) return;

    // Jittered exponential backoff — without jitter, N secondaries reconnect in
    // lockstep after a master restart and hammer it together.
    const backoff = Math.min(BASE_BACKOFF_MS * 2 ** this.attempts, MAX_BACKOFF_MS);
    const delay = backoff * (0.5 + Math.random() * 0.5);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    if (this.attempts <= 3) {
      console.log(`[machine-tunnel] ${this.master.name} ${reason}; retry in ${Math.round(delay)}ms`);
    }
  }

  private send(frame: Frame): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encodeFrame(frame));
  }

  private sendHeartbeat(): void {
    this.send({
      t: 'heartbeat',
      sessionCount: this.deps.sessionCount(),
      version: this.deps.version,
    });
  }

  private async handleFrame(frame: Frame): Promise<void> {
    switch (frame.t) {
      case 'ping':
        this.send({ t: 'pong' });
        break;
      case 'req':
        await this.serveRequest(frame);
        break;
      case 'wsopen':
        this.openChannel(frame.id, frame.path);
        break;
      case 'wsmsg': {
        const socket = this.channels.get(frame.id);
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(frame.binary ? base64ToBytes(frame.data) : frame.data);
        }
        break;
      }
      case 'wsclose': {
        const socket = this.channels.get(frame.id);
        this.channels.delete(frame.id);
        try { socket?.close(frame.code ?? 1000, frame.reason); } catch { /* gone */ }
        break;
      }
    }
  }

  /** Serve a master-originated request against our own app, in-process. */
  private async serveRequest(frame: Extract<Frame, { t: 'req' }>): Promise<void> {
    try {
      const headers = deserializeHeaders(frame.headers);
      headers.set(TUNNEL_AUTH_HEADER, TUNNEL_INTERNAL_SECRET);
      headers.set(TUNNEL_MACHINE_HEADER, this.master.id);

      const port = process.env.RA_PORT || process.env.PORT || 5100;
      const request = new Request(`http://127.0.0.1:${port}${frame.path}`, {
        method: frame.method,
        headers,
        body: frame.body ? base64ToBytes(frame.body) : undefined,
      });

      const response = await this.deps.dispatch(request);
      const buffer = new Uint8Array(await response.arrayBuffer());

      this.send({
        t: 'res',
        id: frame.id,
        status: response.status,
        statusText: response.statusText,
        headers: serializeHeaders(response.headers),
        body: buffer.byteLength > 0 ? bytesToBase64(buffer) : undefined,
      });
    } catch (err) {
      this.send({ t: 'err', id: frame.id, message: (err as Error).message });
    }
  }

  /** Bridge a tunnelled WS channel to a local WebSocket endpoint. */
  private openChannel(id: string, path: string): void {
    let socket: WebSocket;
    try {
      const port = process.env.RA_PORT || process.env.PORT || 5100;
      socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, {
        headers: {
          [TUNNEL_AUTH_HEADER]: TUNNEL_INTERNAL_SECRET,
          [TUNNEL_MACHINE_HEADER]: this.master.id,
        },
      } as unknown as string[]);
    } catch (err) {
      this.send({ t: 'wsclose', id, code: 1011, reason: (err as Error).message });
      return;
    }

    this.channels.set(id, socket);

    socket.addEventListener('open', () => this.send({ t: 'wsready', id }));
    socket.addEventListener('message', (event) => {
      const data = event.data;
      if (typeof data === 'string') {
        this.send({ t: 'wsmsg', id, data, binary: false });
      } else {
        const bytes = data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data as ArrayBufferLike);
        this.send({ t: 'wsmsg', id, data: bytesToBase64(bytes), binary: true });
      }
    });
    socket.addEventListener('close', (event) => {
      this.channels.delete(id);
      this.send({ t: 'wsclose', id, code: event.code || 1000, reason: event.reason });
    });
    socket.addEventListener('error', () => {
      this.channels.delete(id);
      this.send({ t: 'wsclose', id, code: 1011, reason: 'Local socket error' });
    });
  }

  private closeChannels(): void {
    for (const [, socket] of this.channels) {
      try { socket.close(1001, 'Tunnel lost'); } catch { /* gone */ }
    }
    this.channels.clear();
  }
}

class MachineTunnelClient {
  private tunnels = new Map<string, MasterTunnel>();
  private deps: Deps | null = null;

  /** Called once at boot with the app dispatcher; safe to call before pairing. */
  configure(deps: Deps): void {
    this.deps = deps;
  }

  /** Reconcile open tunnels against the current paired-master list. */
  sync(masters: PairedMaster[]): void {
    if (!this.deps) return;

    const wanted = new Set(masters.map((m) => m.id));
    for (const [id, tunnel] of [...this.tunnels]) {
      if (!wanted.has(id)) {
        tunnel.stop();
        this.tunnels.delete(id);
      }
    }
    for (const master of masters) {
      if (this.tunnels.has(master.id)) continue;
      const tunnel = new MasterTunnel(master, this.deps);
      this.tunnels.set(master.id, tunnel);
      tunnel.start();
    }
  }

  isConnected(masterId: string): boolean {
    return this.tunnels.get(masterId)?.connected ?? false;
  }

  shutdown(): void {
    for (const [, tunnel] of this.tunnels) tunnel.stop();
    this.tunnels.clear();
  }
}

export const machineTunnelClient = new MachineTunnelClient();
