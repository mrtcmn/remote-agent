import { Elysia, t } from 'elysia';
import { requireAuth } from '../auth/middleware';
import { pairedMastersService } from '../services/paired-masters';
import { masterSyncService } from '../services/master-sync';

export const pairedMastersRoutes = new Elysia({ prefix: '/paired-masters' })
  .use(requireAuth)

  .get('/', async ({ user }) => {
    const masters = await pairedMastersService.list(user!.id);
    return {
      masters: masters.map((m) => {
        const { machineToken, ...rest } = m;
        return rest;
      }),
    };
  })

  .post('/', async ({ user, body, set }) => {
    const result = await pairedMastersService.pair({
      url: body.url,
      pairingToken: body.token,
      name: body.name,
      userId: user!.id,
    });

    if (!result.ok) {
      set.status = 400;
      return { error: result.error };
    }

    // Kick off an immediate sync so the user sees peers right away.
    masterSyncService.syncNow().catch((err) => {
      console.error('[paired-masters] syncNow after pair failed:', err);
    });

    const { machineToken, ...safe } = result.master;
    return { master: safe };
  }, {
    body: t.Object({
      url: t.String({ minLength: 1 }),
      token: t.String({ minLength: 1 }),
      name: t.String({ minLength: 1, maxLength: 100 }),
    }),
  })

  .delete('/:id', async ({ user, params, set }) => {
    const removed = await pairedMastersService.unpair(params.id, user!.id);
    if (!removed) {
      set.status = 404;
      return { error: 'Master not found' };
    }
    return { ok: true };
  })

  .get('/:id/peers', async ({ user, params, set }) => {
    const master = await pairedMastersService.get(params.id, user!.id);
    if (!master) {
      set.status = 404;
      return { error: 'Master not found' };
    }
    return { peers: masterSyncService.getPeers(master.id) };
  });
