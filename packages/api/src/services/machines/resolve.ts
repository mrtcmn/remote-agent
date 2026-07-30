import { pairedMastersService } from '../paired-masters';
import { masterSyncService } from '../master-sync';
import { machineRegistry } from '../machine-registry';
import { machineTunnel } from '../machine-tunnel/server';
import type { Bytes } from '../machine-tunnel/protocol';

/** Names a machine to relay to, when the request itself goes to the hub. */
export const TARGET_MACHINE_HEADER = 'x-target-machine-id';
/** Hop counter. Present ⇒ already relayed once ⇒ must not be relayed again. */
export const MACHINE_HOPS_HEADER = 'x-machine-hops';

export type MachineTarget =
  /** Reachable by URL — a paired master. Plain fetch. */
  | { kind: 'direct'; machineId: string; name: string; url: string; token: string }
  /** Behind NAT, holding a tunnel to us — a paired secondary. */
  | { kind: 'tunnel'; machineId: string; name: string }
  /** A peer behind our hub: fetch the hub, naming the peer in a header. */
  | { kind: 'relay'; machineId: string; name: string; url: string; token: string; via: string };

/**
 * Resolve a machineId to a transport, from the perspective of THIS machine.
 * The same id resolves differently on a master than on a secondary — which is
 * what lets callers stay transport-agnostic.
 */
export async function resolveMachine(
  machineId: string,
  userId: string,
): Promise<MachineTarget | null> {
  if (!machineId || machineId === 'self') return null;

  // 1. A master we paired with — reachable directly. (Existing behaviour.)
  const master = await pairedMastersService.get(machineId, userId);
  if (master) {
    return {
      kind: 'direct',
      machineId: master.id,
      name: master.name,
      url: master.url,
      token: master.machineToken,
    };
  }

  // 2. A secondary that paired with us — reachable over its tunnel.
  const machines = await machineRegistry.listForUser(userId);
  const secondary = machines.find((m) => m.id === machineId);
  if (secondary) {
    if (!machineTunnel.isOnline(secondary.id)) return null;
    return { kind: 'tunnel', machineId: secondary.id, name: secondary.name };
  }

  // 3. A peer sitting behind one of our masters — reachable by relay.
  //    The peer list is already cached from the sync loop; no extra I/O.
  for (const hub of await pairedMastersService.list(userId)) {
    const peer = masterSyncService.getPeers(hub.id).find((p) => p.id === machineId);
    if (!peer) continue;
    if (!peer.online) return null;
    return {
      kind: 'relay',
      machineId: peer.id,
      name: peer.name,
      url: hub.url,
      token: hub.machineToken,
      via: hub.id,
    };
  }

  return null;
}

/**
 * Every machine this one can currently reach, for fan-out. Excludes `self` —
 * callers prepend their locally-computed result.
 */
export async function listTargets(userId: string): Promise<MachineTarget[]> {
  const targets: MachineTarget[] = [];
  const seen = new Set<string>();

  for (const master of await pairedMastersService.list(userId)) {
    if (seen.has(master.id)) continue;
    seen.add(master.id);
    targets.push({
      kind: 'direct',
      machineId: master.id,
      name: master.name,
      url: master.url,
      token: master.machineToken,
    });

    // Peers of that master, reachable by relaying through it.
    for (const peer of masterSyncService.getPeers(master.id)) {
      if (seen.has(peer.id) || !peer.online) continue;
      seen.add(peer.id);
      targets.push({
        kind: 'relay',
        machineId: peer.id,
        name: peer.name,
        url: master.url,
        token: master.machineToken,
        via: master.id,
      });
    }
  }

  // Secondaries paired to us, currently holding a tunnel open.
  for (const machine of await machineRegistry.listForUser(userId)) {
    if (seen.has(machine.id) || !machineTunnel.isOnline(machine.id)) continue;
    seen.add(machine.id);
    targets.push({ kind: 'tunnel', machineId: machine.id, name: machine.name });
  }

  return targets;
}

/**
 * Issue a request to a resolved target. The single place transport is chosen —
 * proxy and fan-out both route through it so they cannot drift apart.
 */
export async function machineFetch(
  target: MachineTarget,
  path: string,
  init: { method?: string; headers?: Headers; body?: Bytes | null; signal?: AbortSignal } = {},
): Promise<Response> {
  if (target.kind === 'tunnel') {
    return machineTunnel.fetch(target.machineId, path, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: init.signal,
    });
  }

  const headers = new Headers(init.headers ?? {});
  headers.set('authorization', `Bearer ${target.token}`);
  headers.set('accept-encoding', 'identity');
  if (target.kind === 'relay') {
    headers.set(TARGET_MACHINE_HEADER, target.machineId);
  }

  return fetch(`${target.url}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body && init.body.byteLength > 0 ? init.body : undefined,
    signal: init.signal,
    redirect: 'manual',
  });
}
