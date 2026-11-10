import { Elysia, t } from 'elysia';
import { codeServerManager } from '../services/code-server/code-server.service';
import { requireAuth } from '../auth/middleware';

export const editorRoutes = new Elysia({ prefix: '/editor' })
  .use(requireAuth)

  // Get code-server status
  .get('/status', () => {
    return {
      status: codeServerManager.getStatus(),
      configured: codeServerManager.isInstalled(),
    };
  })

  // Start code-server (if not running) and return where the /code proxy serves it
  .post('/open', async ({ body, set }) => {
    await codeServerManager.ensureRunning();

    if (codeServerManager.getStatus() !== 'running') {
      set.status = 503;
      return { error: 'Code server failed to start' };
    }

    // A path, not a URL: the caller adds its own origin and machine prefix.
    const path = body.folder ? `/code/?folder=${encodeURIComponent(body.folder)}` : '/code/';
    return { path, status: 'running' };
  }, {
    body: t.Object({
      folder: t.Optional(t.String()),
    }),
  })

  // Heartbeat — resets the idle timer
  .post('/heartbeat', () => {
    codeServerManager.resetIdleTimer();
    return { status: codeServerManager.getStatus() };
  });
