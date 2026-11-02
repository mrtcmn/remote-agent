import { Elysia, t } from 'elysia';
import { browserPreviewService } from '../services/browser-preview';
import type { ViewportPreset } from '../services/browser-preview';
import { requireAuth } from '../auth/middleware';
import { getDefaultPort } from '../config/paths';

/** The desktop app's browser panel (a CEF webview) listens here for CDP; its
 *  chromiumFlags in packages/desktop/electrobun.config.ts must match. */
export const CDP_PORT = getDefaultPort() + 10;

// ponytail: in memory — a restart forgets open panels, and the agent reopens one.
const opened = new Map<string, { url: string; at: number; agentUntil?: number }>();

/** The agent just ran agent-browser: draw its cursor in the panel for a while. */
export function markAgentBrowsing(sessionId: string) {
  const browser = opened.get(sessionId);
  if (browser) browser.agentUntil = Date.now() + 15_000;
}

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

  // The agent's browser: the desktop app shows the URL in its right panel.
  .post('/open', ({ body }) => {
    opened.set(body.sessionId, { url: body.url, at: Date.now() });
    return { url: body.url, cdpPort: CDP_PORT };
  }, {
    body: t.Object({ sessionId: t.String(), url: t.String() }),
  })
  .get('/open', () => ({
    browsers: [...opened].map(([sessionId, b]) => ({ sessionId, ...b })),
  }))
  .delete('/open/:sessionId', ({ params }) => ({ closed: opened.delete(params.sessionId) }))

  // DevTools for the panel's page. The UI cannot read /json/list itself: CDP
  // sends no CORS headers.
  .get('/inspector', async ({ query, set }) => {
    const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
      .then((r) => r.json() as Promise<{ type: string; url: string; devtoolsFrontendUrl?: string }[]>)
      .catch(() => []);
    // An open inspector is a page too; never inspect the inspector.
    const pages = targets.filter((t) => t.type === 'page' && t.devtoolsFrontendUrl && !t.url.includes('/devtools/'));
    const page = pages.find((t) => t.url === query.url) ?? pages[0];
    if (!page) {
      set.status = 404;
      return { error: `No browser page on CDP port ${CDP_PORT}` };
    }
    return { url: `http://127.0.0.1:${CDP_PORT}${page.devtoolsFrontendUrl}` };
  }, {
    query: t.Object({ url: t.Optional(t.String()) }),
  })

  // List active previews
  .get('/active', async () => {
    const previews = browserPreviewService.getActivePreviews();
    return { previews };
  });
