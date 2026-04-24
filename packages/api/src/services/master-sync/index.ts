import { pairedMastersService } from '../paired-masters';
import { terminalService } from '../terminal';
import type { PairedMaster } from '../../db/schema';

const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const HEARTBEAT_TIMEOUT_MS = 10 * 1000;
const AGENT_VERSION = process.env.npm_package_version || '1.0.0';

// Lightweight shape of what /api/machines/me/peers returns per machine.
export interface PeerSummary {
  id: string;
  name: string;
  role: 'master' | 'secondary';
  online: boolean;
  sessionCount: number;
  lastSeenAt: string | null;
  version: string | null;
}

class MasterSyncService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private peersByMaster = new Map<string, PeerSummary[]>();
  private inflight = false;

  async initialize(): Promise<void> {
    if (this.timer) return;
    // Fire an immediate tick so freshly-paired masters show status quickly.
    this.tick().catch((err) => console.error('[master-sync] initial tick error:', err));
    this.timer = setInterval(() => {
      this.tick().catch((err) => console.error('[master-sync] tick error:', err));
    }, HEARTBEAT_INTERVAL_MS);
  }

  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Peers last reported by the given master, or an empty list. */
  getPeers(masterId: string): PeerSummary[] {
    return this.peersByMaster.get(masterId) ?? [];
  }

  /** Force an immediate sync (e.g., right after pairing). */
  async syncNow(): Promise<void> {
    await this.tick();
  }

  private async tick(): Promise<void> {
    if (this.inflight) return;
    this.inflight = true;
    try {
      const masters = await pairedMastersService.listAll();
      await Promise.all(masters.map((m) => this.syncOne(m)));
    } finally {
      this.inflight = false;
    }
  }

  private async syncOne(master: PairedMaster): Promise<void> {
    try {
      await this.heartbeat(master);
      const peers = await this.fetchPeers(master);
      this.peersByMaster.set(master.id, peers);
      await pairedMastersService.recordSync(master.id, { success: true });
    } catch (err) {
      this.peersByMaster.delete(master.id);
      await pairedMastersService.recordSync(master.id, {
        success: false,
        error: (err as Error).message,
      });
    }
  }

  private async heartbeat(master: PairedMaster): Promise<void> {
    const res = await this.call(master, '/api/machines/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        sessionCount: terminalService.getActiveCount(),
        version: AGENT_VERSION,
      }),
    });
    if (!res.ok) throw new Error(`Heartbeat failed: HTTP ${res.status}`);
  }

  private async fetchPeers(master: PairedMaster): Promise<PeerSummary[]> {
    const res = await this.call(master, '/api/machines/me/peers', { method: 'GET' });
    if (!res.ok) throw new Error(`Peers fetch failed: HTTP ${res.status}`);
    const body = await res.json() as { peers: Array<Record<string, unknown>> };
    return body.peers.map((p) => ({
      id: String(p.id),
      name: String(p.name),
      role: p.role as 'master' | 'secondary',
      online: Boolean(p.online),
      sessionCount: Number(p.sessionCount ?? 0),
      lastSeenAt: p.lastSeenAt ? String(p.lastSeenAt) : null,
      version: p.version ? String(p.version) : null,
    }));
  }

  private async call(
    master: PairedMaster,
    path: string,
    init: { method: string; body?: string },
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);
    try {
      return await fetch(`${master.url}${path}`, {
        method: init.method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${master.machineToken}`,
        },
        body: init.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const masterSyncService = new MasterSyncService();
