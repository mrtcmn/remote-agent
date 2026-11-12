import type { MachineTarget } from './resolve';
import { TICKET_SCHEME } from './ticket';

type DirectTarget = Extract<MachineTarget, { kind: 'direct' }>;
export interface Pass { ticket: string; exp: number }

const RECHECK_MS = 30_000;
const PROBE_TIMEOUT_MS = 1_500;
/** Stop using a ticket this long before it expires. */
const EXP_MARGIN_MS = 30_000;

export function authHeader(target: { token: string; auth?: 'ticket' }): string {
  return target.auth === 'ticket' ? `${TICKET_SCHEME}${target.token}` : `Bearer ${target.token}`;
}

/** True when the machine at `url` accepts the ticket and says it is `machineId`. */
async function httpProbe(url: string, ticket: string, machineId: string): Promise<boolean> {
  const res = await fetch(`${url}/api/machines/whoami`, {
    headers: { authorization: `${TICKET_SCHEME}${ticket}` },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    redirect: 'manual',
  });
  if (!res.ok) return false;
  const body = await res.json() as { machineId?: string };
  return body.machineId === machineId;
}

interface Entry { ok: boolean; url: string; pass?: Pass; checkedAt: number; ms?: number }

/**
 * Remembers which machines answer on their direct address.
 *
 * `upgrade` never waits: it answers from the last check and starts a new check
 * in the background when the last one is old. So the first call to a machine
 * uses the tunnel or the relay, and later calls use the direct address.
 */
export class DirectPaths {
  private cache = new Map<string, Entry>();
  private inflight = new Map<string, Promise<void>>();

  constructor(private probe = httpProbe, private now: () => number = Date.now) {}

  upgrade(original: MachineTarget, directUrl: string | null, mint: () => Promise<Pass> | Pass): MachineTarget {
    if (!directUrl) return original;
    if (original.kind === 'direct' && original.url === directUrl) return original;

    const id = original.machineId;
    const entry = this.cache.get(id);
    const now = this.now();
    if (!entry || entry.url !== directUrl || now - entry.checkedAt > RECHECK_MS) this.check(id, directUrl, mint);
    if (!entry?.ok || entry.url !== directUrl || !entry.pass || entry.pass.exp - EXP_MARGIN_MS <= now) return original;

    const direct: DirectTarget = {
      kind: 'direct', machineId: id, name: original.name,
      url: directUrl, token: entry.pass.ticket, auth: 'ticket', fallback: original,
    };
    return direct;
  }

  /** A direct call failed: use the old path until the next check passes. */
  fail(machineId: string): void {
    const entry = this.cache.get(machineId);
    if (entry) this.cache.set(machineId, { ...entry, ok: false, checkedAt: this.now() });
  }

  /** Response time of the last good check, for the network map. */
  latency(machineId: string): number | null {
    const entry = this.cache.get(machineId);
    return entry?.ok ? entry.ms ?? null : null;
  }

  /** Test hook: wait for the checks that are in flight. */
  async settle(): Promise<void> {
    await Promise.all(this.inflight.values());
  }

  private check(id: string, url: string, mint: () => Promise<Pass> | Pass): void {
    if (this.inflight.has(id)) return;
    const run = (async () => {
      let entry: Entry = { ok: false, url, checkedAt: this.now() };
      try {
        const pass = await mint();
        const started = this.now();
        if (await this.probe(url, pass.ticket, id)) entry = { ok: true, url, pass, checkedAt: this.now(), ms: this.now() - started };
      } catch { /* unreachable, or an older hub that issues no ticket */ }
      this.cache.set(id, entry);
      this.inflight.delete(id);
    })();
    this.inflight.set(id, run);
  }
}

export const directPaths = new DirectPaths();
