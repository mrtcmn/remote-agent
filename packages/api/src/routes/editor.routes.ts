import { Elysia, t } from 'elysia';
import { codeServerManager } from '../services/code-server/code-server.service';
import { requireAuth } from '../auth/middleware';

const CODE_SERVER_URL = process.env.VITE_CODE_SERVER_URL || '';

export const editorRoutes = new Elysia({ prefix: '/editor' })
  .use(requireAuth)

  // Get code-server status
  .get('/status', () => {
    return {
      status: codeServerManager.getStatus(),
      configured: !!CODE_SERVER_URL,
    };
  })

  // Start code-server (if not running) and return the URL for a given folder
  .post('/open', async ({ body, set }) => {
    if (!CODE_SERVER_URL) {
      set.status = 503;
      return { error: 'Code server not configured (set CODE_SERVER_URL)' };
    }

    await codeServerManager.ensureRunning();

    const status = codeServerManager.getStatus();
    if (status !== 'running') {
      set.status = 503;
      return { error: 'Code server failed to start' };
    }

    const baseUrl = CODE_SERVER_URL.replace(/\/$/, '');
    const url = body.folder
      ? `${baseUrl}/?folder=${encodeURIComponent(body.folder)}`
      : baseUrl;

    return { url, status: 'running' };
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
