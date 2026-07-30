import { Elysia } from 'elysia';
import { auth } from '../auth';
import { machineRegistry } from '../services/machine-registry';
import { machineTunnel } from '../services/machine-tunnel/server';
import { TARGET_MACHINE_HEADER, MACHINE_HOPS_HEADER } from '../services/machines/resolve';
import { decideRelay } from './relay-decision';

const RELAY_TIMEOUT_MS = 7_000;

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host',
  'content-length', 'content-encoding', 'accept-encoding',
]);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Headers to carry onward, minus auth and routing headers we re-set ourselves. */
function forwardHeaders(source: Headers): Headers {
  const out = new Headers();
  source.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    if (lower === 'authorization' || lower === 'cookie') return;
    if (lower === TARGET_MACHINE_HEADER || lower === MACHINE_HOPS_HEADER) return;
    out.set(key, value);
  });
  // Marks the request as already relayed; the far side refuses to relay again.
  out.set(MACHINE_HOPS_HEADER, '1');
  return out;
}

/**
 * Hub side of secondary → master → secondary.
 *
 * A request arriving with `X-Target-Machine-Id` naming a *different* machine is
 * forwarded over that machine's tunnel instead of being served locally. Without
 * this, the master serves it itself — which is today's behaviour and the reason
 * peers cannot see each other.
 *
 * Install BEFORE any route, and only on a machine acting as a hub (harmless
 * elsewhere: with no tunnels registered, every relay attempt 404s/502s).
 */
export const machineRelayPlugin = new Elysia({ name: 'machine-relay' })
  .onRequest(async ({ request }) => {
    const targetMachineId = request.headers.get(TARGET_MACHINE_HEADER);
    if (!targetMachineId) return; // fast path: not a relay request

    // Identify the caller: cookie session, else machineToken bearer.
    let callerOwnerUserId: string | null = null;
    let callerMachineId: string | null = null;

    const session = await auth.api.getSession({ headers: request.headers });
    if (session) {
      callerOwnerUserId = session.user.id;
    } else {
      const authHeader = request.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const caller = await machineRegistry.findByToken(authHeader.slice(7).trim());
        if (caller) {
          callerOwnerUserId = caller.ownerUserId;
          callerMachineId = caller.id;
        }
      }
    }

    // Look the target up only within the caller's own machines.
    const target = callerOwnerUserId
      ? (await machineRegistry.listForUser(callerOwnerUserId))
          .find((m) => m.id === targetMachineId) ?? null
      : null;

    const decision = decideRelay({
      targetMachineId,
      hops: request.headers.get(MACHINE_HOPS_HEADER),
      callerMachineId,
      callerOwnerUserId,
      targetOwnerUserId: target?.ownerUserId ?? null,
      targetOnline: machineTunnel.isOnline(targetMachineId),
    });

    if (decision.action === 'serve-locally') return;
    if (decision.action === 'reject') return json(decision.status, { error: decision.error });

    const url = new URL(request.url);
    const body = request.method === 'GET' || request.method === 'HEAD'
      ? null
      : new Uint8Array(await request.arrayBuffer());

    try {
      const upstream = await machineTunnel.fetch(
        decision.targetMachineId,
        `${url.pathname}${url.search}`,
        {
          method: request.method,
          headers: forwardHeaders(request.headers),
          body,
          // Deliberately shorter than the caller's fan-out timeout (8s) so the
          // hub reports a clean 502 instead of the caller timing out on us.
          timeoutMs: RELAY_TIMEOUT_MS,
        },
      );

      const respHeaders = new Headers();
      upstream.headers.forEach((value, key) => {
        if (!HOP_BY_HOP.has(key.toLowerCase())) respHeaders.set(key, value);
      });

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: respHeaders,
      });
    } catch (err) {
      return json(502, { error: `Relay failed: ${(err as Error).message}` });
    }
  });
