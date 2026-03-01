import { Elysia, t } from 'elysia';
import { browserPreviewService } from '../services/browser-preview';
import type { ViewportPreset } from '../services/browser-preview';
import { requireAuth } from '../auth/middleware';

export const previewRoutes = new Elysia({ prefix: '/preview' })
  .use(requireAuth)

  // Start a browser preview
  .post('/start', async ({ body, set }) => {
    try {
      const instance = await browserPreviewService.start({
        terminalId: body.sessionId, // Use sessionId as reference
        targetUrl: body.url,
        viewport: (body.viewport as ViewportPreset) || 'desktop',
      });

      return {
        previewId: instance.id,
        viewport: instance.viewport,
        url: instance.targetUrl,
        status: instance.status,
      };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    body: t.Object({
      url: t.String(),
      viewport: t.Optional(t.String()),
      sessionId: t.String(),
    }),
  })

  // Stop a preview
  .post('/:id/stop', async ({ params, set }) => {
    try {
      await browserPreviewService.stop(params.id);
      return { success: true };
    } catch (error) {
      set.status = 404;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // List active previews
  .get('/active', async () => {
    const previews = browserPreviewService.getActivePreviews();
    return { previews };
  });
