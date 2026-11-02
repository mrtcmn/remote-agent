import { Elysia, t } from 'elysia';
import { requireAuth } from '../auth/middleware';
import { viewsService, VIEW_TOOLS } from '../services/views';

const Panel = t.Object({
  id: t.Optional(t.String()),
  machineId: t.Optional(t.Nullable(t.String())),
  sessionId: t.String(),
  kind: t.Union([t.Literal('terminal'), t.Literal('tool')]),
  terminalId: t.Optional(t.Nullable(t.String())),
  tool: t.Optional(t.Nullable(t.Union(VIEW_TOOLS.map((x) => t.Literal(x))))),
});

const notFound = (set: { status?: number | string }) => {
  set.status = 404;
  return { error: 'View not found' };
};

export const viewRoutes = new Elysia({ prefix: '/views' })
  .use(requireAuth)

  .get('/', async ({ user }) => ({ views: await viewsService.list(user!.id) }))

  .get('/:id', async ({ user, params, set }) =>
    (await viewsService.get(params.id, user!.id)) ?? notFound(set))

  .post('/', async ({ user, body }) => viewsService.create(user!.id, body), {
    body: t.Object({
      name: t.Optional(t.String({ maxLength: 100 })),
      layout: t.Optional(t.Unknown()),
      panels: t.Array(Panel),
    }),
  })

  .patch('/:id', async ({ user, params, body, set }) =>
    (await viewsService.update(params.id, user!.id, body)) ? { ok: true } : notFound(set), {
    body: t.Object({
      name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
      layout: t.Optional(t.Unknown()),
      position: t.Optional(t.Integer({ minimum: 0 })),
    }),
  })

  .delete('/:id', async ({ user, params, set }) =>
    (await viewsService.remove(params.id, user!.id)) ? { ok: true } : notFound(set))

  .post('/:id/panels', async ({ user, params, body, set }) =>
    (await viewsService.addPanel(params.id, user!.id, body)) ?? notFound(set), { body: Panel })

  .patch('/:id/panels/:panelId', async ({ user, params, body, set }) =>
    (await viewsService.setPanelTerminal(params.id, params.panelId, user!.id, body.terminalId))
      ? { ok: true }
      : notFound(set), {
    body: t.Object({ terminalId: t.String() }),
  })

  .delete('/:id/panels/:panelId', async ({ user, params, set }) =>
    (await viewsService.removePanel(params.id, params.panelId, user!.id)) ? { ok: true } : notFound(set));
