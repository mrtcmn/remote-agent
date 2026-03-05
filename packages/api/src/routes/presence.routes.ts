import { Elysia, t } from 'elysia';
import { requireAuth } from '../auth/middleware';
import { presenceManager } from '../services/presence';

export const presenceRoutes = new Elysia({ prefix: '/presence' })
  .use(requireAuth)

  .post('/heartbeat', async ({ user, body }) => {
    presenceManager.heartbeat(user!.id, body.terminalId);
    return { ok: true };
  }, {
    body: t.Object({
      terminalId: t.Optional(t.String()),
    }),
  });
