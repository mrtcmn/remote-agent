import { Elysia, t } from 'elysia';
import { requireAuth } from '../auth/middleware';
import { machineRegistry } from '../services/machine-registry';

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
    });
    return { ok: true };
  }, {
    body: t.Object({
      sessionCount: t.Integer({ minimum: 0 }),
      version: t.Optional(t.String()),
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
      peers: peers
        .filter((p) => p.id !== session.machineId)
        .map(({ tokenHash, ...rest }) => rest),
    };
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

  .get('/', async ({ user }) => {
    const machines = await machineRegistry.listForUser(user!.id);
    return { machines: machines.map(({ tokenHash, ...rest }) => rest) };
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
