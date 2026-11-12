import { listTargets, machineFetch, type MachineTarget } from './resolve';
import { machineRegistry } from '../machine-registry';
import { pairedMastersService } from '../paired-masters';
import { masterSyncService } from '../master-sync';
import { machineIdentity } from '../machine-identity';
import { directAddress } from '../direct-address';
import { APP_VERSION } from '../../config/version';

/** address = the machine's direct address; url = the public URL of a master. */
export type PathKind = 'address' | 'url' | 'tunnel' | 'relay';

export interface NetworkNode {
  id: string;
  name: string;
  path: PathKind;
  /** The slower path we return to when the direct address stops answering. */
  fallback: PathKind | null;
  /** For a relay: the hub the call goes through. */
  via: string | null;
  /** Host we call, when there is one. */
  host: string | null;
  online: boolean;
  ms: number | null;
  version: string | null;
  directUrl: string | null;
}

const PING_TIMEOUT_MS = 5_000;

function kindOf(t: MachineTarget): PathKind {
  if (t.kind === 'direct') return t.auth === 'ticket' ? 'address' : 'url';
  return t.kind;
}

export async function networkMap(userId: string): Promise<{
  self: { name: string; version: string; directUrl: string | null };
  nodes: NetworkNode[];
}> {
  const secondaries = await machineRegistry.listForUser(userId);
  const masters = await pairedMastersService.list(userId);
  const peers = masters.flatMap((m) => masterSyncService.getPeers(m.id).map((p) => ({ ...p, via: m.id })));

  const nodes = await Promise.all((await listTargets(userId)).map(async (target): Promise<NetworkNode> => {
    const started = performance.now();
    let online = false;
    try {
      const res = await machineFetch(target, '/health', { signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
      await res.body?.cancel();
      online = res.status < 500;
    } catch { /* offline */ }
    const usual = target.kind === 'direct' && target.fallback ? target.fallback : null;
    const route = usual ?? target;
    const known = secondaries.find((s) => s.id === target.machineId) ?? peers.find((p) => p.id === target.machineId);
    return {
      id: target.machineId,
      name: target.name,
      path: kindOf(target),
      fallback: usual ? kindOf(usual) : null,
      via: route.kind === 'relay' ? route.via : null,
      host: target.kind === 'tunnel' ? null : new URL(target.url).host,
      online,
      ms: online ? Math.round(performance.now() - started) : null,
      version: known?.version ?? null,
      directUrl: known?.directUrl ?? masterSyncService.getHubDirectUrl(target.machineId),
    };
  }));

  // listTargets leaves out machines that are offline; the map still shows them.
  const seen = new Set(nodes.map((n) => n.id));
  const offline = (id: string, name: string, path: PathKind, via: string | null, version: string | null, directUrl: string | null) => {
    if (seen.has(id)) return;
    seen.add(id);
    nodes.push({ id, name, path, fallback: null, via, host: null, online: false, ms: null, version, directUrl });
  };
  for (const s of secondaries) offline(s.id, s.name, 'tunnel', null, s.version, s.directUrl);
  for (const p of peers) offline(p.id, p.name, 'relay', p.via, p.version, p.directUrl);

  return {
    self: { name: machineIdentity.get(), version: APP_VERSION, directUrl: directAddress.get() },
    nodes,
  };
}
