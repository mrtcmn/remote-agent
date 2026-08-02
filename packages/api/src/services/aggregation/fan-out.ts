import { listTargets, machineFetch, type MachineTarget } from '../machines/resolve';
import type { MachineResult } from './merge';

const FANOUT_TIMEOUT_MS = 8000;

/**
 * Turn a failed response into something diagnosable: which transport was used,
 * which host answered, and who answered. An HTML body means an edge/proxy
 * answered (Cloudflare, nginx), not our API — the two have very different fixes,
 * and dumping 200 chars of HTML into the field hides that.
 */
async function describeFailure(target: MachineTarget, res: Response): Promise<string> {
  const where = target.kind === 'tunnel'
    ? 'tunnel'
    : `${target.kind} ${new URL(target.url).host}`;

  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const body = (await res.text().catch(() => '')).slice(0, 200);
    return `HTTP ${res.status} via ${where}: ${body}`;
  }

  // Non-JSON ⇒ not our API. Name the proxy if it identifies itself.
  const via = res.headers.get('cf-ray') ? 'cloudflare' : res.headers.get('server') ?? 'proxy';
  return `HTTP ${res.status} from ${via} (not our API) via ${where}`;
}

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
          return { ...base, online: false, error: await describeFailure(target, res), data: null };
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
