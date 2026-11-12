import { pairedMastersService } from '../paired-masters';
import { masterSyncService } from '../master-sync';
import { machineRegistry } from '../machine-registry';
import { machineTunnel } from '../machine-tunnel/server';
import type { Bytes } from '../machine-tunnel/protocol';
import type { PairedMaster, Machine } from '../../db/schema';
import { authHeader, directPaths, type Pass } from './direct-path';
import { signTicket, tokenKey, TICKET_TTL_MS } from './ticket';

/** Names a machine to relay to, when the request itself goes to the hub. */
export const TARGET_MACHINE_HEADER = 'x-target-machine-id';
/** Hop counter. Present ⇒ already relayed once ⇒ must not be relayed again. */
export const MACHINE_HOPS_HEADER = 'x-machine-hops';

export type MachineTarget =
  /** Reachable by URL — a paired master. Plain fetch. */
  | {
      kind: 'direct'; machineId: string; name: string; url: string; token: string;
      /** `token` is a short-lived ticket for the machine's direct address. */
      auth?: 'ticket';
      /** The path to use when the direct address stops answering. */
      fallback?: MachineTarget;
    }
  /** Behind NAT, holding a tunnel to us — a paired secondary. */
  | { kind: 'tunnel'; machineId: string; name: string }
  /** A peer behind our hub: fetch the hub, naming the peer in a header. */
  | { kind: 'relay'; machineId: string; name: string; url: string; token: string; via: string };

// ── Direct address: one plain hop, tried before the public URL, tunnel or relay ──

/** We call a master: sign with our own token's key. */
function viaMasterAddress(master: PairedMaster, target: MachineTarget): MachineTarget {
  return directPaths.upgrade(target, masterSyncService.getHubDirectUrl(master.id), () => {
    const exp = Date.now() + TICKET_TTL_MS;
    return { exp, ticket: signTicket({ from: master.id, to: 'hub', exp }, tokenKey(master.machineToken)) };
  });
}

/** We call a peer: only the hub can sign for it. */
function viaPeerAddress(hub: PairedMaster, directUrl: string | null, target: MachineTarget): MachineTarget {
  return directPaths.upgrade(target, directUrl, async () => {
    const res = await masterSyncService.call(hub, `/api/machines/${target.machineId}/ticket`, { method: 'POST' });
    if (!res.ok) throw new Error(`Ticket refused: HTTP ${res.status}`);
    return await res.json() as Pass;
  });
}

/** We are the hub and call a secondary: we hold its key. */
function viaSecondaryAddress(machine: Machine, target: MachineTarget): MachineTarget {
  return directPaths.upgrade(target, machine.directUrl, () => {
    const exp = Date.now() + TICKET_TTL_MS;
    return { exp, ticket: signTicket({ from: 'hub', to: machine.id, exp }, machine.tokenHash) };
  });
}

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
    return viaMasterAddress(master, {
      kind: 'direct',
      machineId: master.id,
      name: master.name,
      url: master.url,
      token: master.machineToken,
    });
  }

  // 2. A secondary that paired with us — reachable over its tunnel.
  const machines = await machineRegistry.listForUser(userId);
  const secondary = machines.find((m) => m.id === machineId);
  if (secondary) {
    if (!machineTunnel.isOnline(secondary.id)) return null;
    return viaSecondaryAddress(secondary, { kind: 'tunnel', machineId: secondary.id, name: secondary.name });
  }

  // 3. A peer sitting behind one of our masters — reachable by relay.
  //    The peer list is already cached from the sync loop; no extra I/O.
  for (const hub of await pairedMastersService.list(userId)) {
    const peer = masterSyncService.getPeers(hub.id).find((p) => p.id === machineId);
    if (!peer) continue;
    if (!peer.online) return null;
    return viaPeerAddress(hub, peer.directUrl, {
      kind: 'relay',
      machineId: peer.id,
      name: peer.name,
      url: hub.url,
      token: hub.machineToken,
      via: hub.id,
    });
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
    targets.push(viaMasterAddress(master, {
      kind: 'direct',
      machineId: master.id,
      name: master.name,
      url: master.url,
      token: master.machineToken,
    }));

    // Peers of that master, reachable by relaying through it.
    for (const peer of masterSyncService.getPeers(master.id)) {
      if (seen.has(peer.id) || !peer.online) continue;
      seen.add(peer.id);
      targets.push(viaPeerAddress(master, peer.directUrl, {
        kind: 'relay',
        machineId: peer.id,
        name: peer.name,
        url: master.url,
        token: master.machineToken,
        via: master.id,
      }));
    }
  }

  // Secondaries paired to us, currently holding a tunnel open.
  for (const machine of await machineRegistry.listForUser(userId)) {
    if (seen.has(machine.id) || !machineTunnel.isOnline(machine.id)) continue;
    seen.add(machine.id);
    targets.push(viaSecondaryAddress(machine, { kind: 'tunnel', machineId: machine.id, name: machine.name }));
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
  init: {
    method?: string; headers?: Headers; body?: Bytes | null; signal?: AbortSignal;
    /** Tunnel only; the default suits API calls, not a multi-megabyte editor bundle. */
    timeoutMs?: number;
    /** Pass the body through still compressed, with the caller's accept-encoding. */
    raw?: boolean;
  } = {},
): Promise<Response> {
  if (target.kind === 'tunnel') {
    return machineTunnel.fetch(target.machineId, path, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: init.signal,
      timeoutMs: init.timeoutMs,
    });
  }

  const headers = new Headers(init.headers ?? {});
  headers.set('authorization', authHeader(target));
  if (!init.raw) headers.set('accept-encoding', 'identity');
  if (target.kind === 'relay') {
    headers.set(TARGET_MACHINE_HEADER, target.machineId);
  }

  const send = () => fetch(`${target.url}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body && init.body.byteLength > 0 ? init.body : undefined,
    signal: init.signal,
    redirect: 'manual',
    ...(init.raw ? { decompress: false } : {}),
  } as RequestInit);

  if (target.kind !== 'direct' || !target.fallback) return send();
  try {
    return await send();
  } catch (err) {
    directPaths.fail(target.machineId);
    // ponytail: only a read is sent again; a write that died mid-flight may have run.
    // A blackholed address (no refusal) stalls until the next 30 s check — add a
    // connect timeout here if that hurts.
    const method = (init.method ?? 'GET').toUpperCase();
    if (init.signal?.aborted || (method !== 'GET' && method !== 'HEAD')) throw err;
    return machineFetch(target.fallback, path, init);
  }
}
