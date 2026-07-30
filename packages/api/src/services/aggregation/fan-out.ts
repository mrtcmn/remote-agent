import { listTargets, machineFetch } from '../machines/resolve';
import type { MachineResult } from './merge';

const FANOUT_TIMEOUT_MS = 8000;

/**
 * Fetch `path` (an /api-relative path, e.g. '/sessions/sidebar') from every
 * machine this one can currently reach, in parallel:
 *
 *   - paired masters      → direct fetch
 *   - paired secondaries  → over their tunnel
 *   - peers behind a hub  → relayed through that hub
 *
 * Never throws: an unreachable / erroring machine yields { online: false, data: null }
 * so one dead machine never breaks the aggregate view. Does NOT include `self` —
 * the caller prepends its locally-computed result.
 */
export async function fanOutToMachines<T>(userId: string, path: string): Promise<MachineResult<T>[]> {
  const targets = await listTargets(userId);
  if (targets.length === 0) return [];

  return Promise.all(
    targets.map(async (target): Promise<MachineResult<T>> => {
      const base = { machineId: target.machineId, machineName: target.name };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FANOUT_TIMEOUT_MS);
      try {
        const res = await machineFetch(target, `/api${path}`, { signal: ctrl.signal });
        if (!res.ok) {
          return { ...base, online: false, error: `HTTP ${res.status}`, data: null };
        }
        const data = (await res.json()) as T;
        return { ...base, online: true, data };
      } catch (err) {
        return { ...base, online: false, error: (err as Error).message, data: null };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}
