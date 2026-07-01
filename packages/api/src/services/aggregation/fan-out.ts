import { pairedMastersService } from '../paired-masters';
import type { MachineResult } from './merge';

const FANOUT_TIMEOUT_MS = 8000;

/**
 * Fetch `path` (an /api-relative path, e.g. '/sessions/sidebar') from every paired
 * master in parallel, authenticating with each master's machineToken — the same
 * forwarding mechanism the machine-proxy uses, but fanned out.
 *
 * Never throws: an unreachable / erroring master yields { online: false, data: null }
 * so one dead machine never breaks the aggregate view. Does NOT include `self` —
 * the caller prepends its locally-computed result.
 */
export async function fanOutToMasters<T>(userId: string, path: string): Promise<MachineResult<T>[]> {
  const masters = await pairedMastersService.list(userId);
  if (masters.length === 0) return [];

  return Promise.all(
    masters.map(async (m): Promise<MachineResult<T>> => {
      const base = { machineId: m.id, machineName: m.name };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FANOUT_TIMEOUT_MS);
      try {
        const res = await fetch(`${m.url}/api${path}`, {
          headers: {
            authorization: `Bearer ${m.machineToken}`,
            'accept-encoding': 'identity',
          },
          signal: ctrl.signal,
        });
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
