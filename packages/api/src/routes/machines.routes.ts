import { Elysia, t } from 'elysia';
import { requireAuth } from '../auth/middleware';
import { machineRegistry } from '../services/machine-registry';
import { machineTunnel } from '../services/machine-tunnel/server';
import { directAddress } from '../services/direct-address';
import { networkMap } from '../services/machines/network';
import { signTicket, TICKET_TTL_MS } from '../services/machines/ticket';

export const machineRoutes = new Elysia({ prefix: '/machines' })
  // ─── Public: pair with a pairing token ────────────────────────────────

  .post('/pair', async ({ body, set }) => {
    const result = await machineRegistry.consumePairingToken(body.token, body.name);
    if (!result) {
      set.status = 401;
      return { error: 'Invalid or expired pairing token' };
    }
    return {
      machineId: result.machineId,
      machineToken: result.machineToken,
    };
  }, {
    body: t.Object({
      token: t.String(),
      name: t.String({ minLength: 1, maxLength: 100 }),
    }),
  })

  // ─── Auth required (cookie session OR machineToken bearer) ────────────

  .use(requireAuth)

  // Called by a paired secondary only — requires the session to carry a machineId.
  .post('/heartbeat', async ({ session, body, set }) => {
    if (!session?.machineId) {
      set.status = 403;
      return { error: 'Machine token required' };
    }

    await machineRegistry.recordHeartbeat(session.machineId, {
      sessionCount: body.sessionCount,
      version: body.version,
      directUrl: body.directUrl,
    });
    return { ok: true };
  }, {
    body: t.Object({
      sessionCount: t.Integer({ minimum: 0 }),
      version: t.Optional(t.String()),
      directUrl: t.Optional(t.Nullable(t.String())),
    }),
  })

  // Called by a paired secondary — returns owner's other machines.
  .get('/me/peers', async ({ user, session, set }) => {
    if (!session?.machineId) {
      set.status = 403;
      return { error: 'Machine token required' };
    }

    const peers = await machineRegistry.listForUser(user!.id);
    return {
      // Our own direct address: the caller tries it before our public URL.
      hub: { directUrl: directAddress.get() },
      peers: peers
        .filter((p) => p.id !== session.machineId)
        // `online` here means "reachable by relay through us", which requires a
        // live tunnel. A recent heartbeat is not enough — the caller would fan
        // out to it and get a 502 from our relay.
        .map(({ tokenHash, ...rest }) => ({ ...rest, online: machineTunnel.isOnline(rest.id) })),
    };
  })

  // Proves who answered on a direct address: the caller compares the id.
  .get('/whoami', ({ session }) => ({ machineId: session?.machineId ?? null }))

  // A secondary asks for a pass to call one of its peers directly. The key is
  // the target's token hash, so only the hub and the target can make or check it.
  .post('/:id/ticket', async ({ user, session, params, set }) => {
    if (!session?.machineId) {
      set.status = 403;
      return { error: 'Machine token required' };
    }
    const target = await machineRegistry.get(params.id);
    if (!target || target.ownerUserId !== user!.id) {
      set.status = 404;
      return { error: 'Machine not found' };
    }
    const exp = Date.now() + TICKET_TTL_MS;
    return { ticket: signTicket({ from: session.machineId, to: target.id, exp }, target.tokenHash), exp };
  })

  // User-session-only endpoints below (reject machineToken callers).

  .post('/pairing-token', async ({ user, session, set }) => {
    if (session?.machineId) {
      set.status = 403;
      return { error: 'Browser session required' };
    }
    const { token, expiresAt } = await machineRegistry.generatePairingToken(user!.id);
    return {
      token,
      expiresAt: expiresAt.toISOString(),
      masterUrl: process.env.APP_URL || '',
    };
  })

  // Every machine we know, the path we use to reach it, and how fast it answers.
  .get('/network', ({ user }) => networkMap(user!.id))

  .get('/', async ({ user }) => {
    const machines = await machineRegistry.listForUser(user!.id);
    return { machines: machines.map(({ tokenHash, ...rest }) => rest) };
  })

  // Machine tokens allowed: a secondary renames its peers through here. The
  // owner check below keeps it to the same user's machines.
  .patch('/:id', async ({ user, params, body, set }) => {
    const renamed = await machineRegistry.rename(params.id, user!.id, body.name.trim());
    if (!renamed) {
      set.status = 404;
      return { error: 'Machine not found' };
    }
    return { ok: true };
  }, {
    body: t.Object({ name: t.String({ minLength: 1, maxLength: 100 }) }),
  })

  .delete('/:id', async ({ user, session, params, set }) => {
    if (session?.machineId) {
      set.status = 403;
      return { error: 'Browser session required' };
    }
    const removed = await machineRegistry.revoke(params.id, user!.id);
    if (!removed) {
      set.status = 404;
      return { error: 'Machine not found' };
    }
    return { ok: true };
  });
