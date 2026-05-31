import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { getAssetPath, uiServingMode } from './ui-assets';
import { api, internalRoutes } from './routes';
import { terminalWebsocketRoutes } from './routes/terminal-websocket';
import { previewWebsocketRoutes } from './routes/preview-websocket';
import { notificationService } from './services/notification';
import { terminalService } from './services/terminal';
import { browserPreviewService } from './services/browser-preview';
import { codeServerManager } from './services/code-server/code-server.service';
import { originsService } from './services/origins';
import { masterSyncService } from './services/master-sync';
import { machineProxyPlugin } from './plugins/machine-proxy';
import { seedTestUser } from './auth/seed';

const PORT = process.env.RA_PORT || process.env.PORT || 5100;

const CLIENT_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_MEASUREMENT_ID',
  'VITE_FIREBASE_VAPID_KEY',
  'VITE_CODE_SERVER_URL',
];

function buildEnvScript(): string {
  const env: Record<string, string> = {};
  for (const key of CLIENT_ENV_KEYS) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return `<script>window.__ENV__=${JSON.stringify(env)}</script>`;
}

// Index HTML is resolved per-request in dev so it always reflects the latest
// Vite build (hashed `<script>` tags). In compiled-binary mode the lookup is
// cached by getAssetPath.
async function loadIndexHtml(): Promise<string | null> {
  const path = await getAssetPath('/index.html');
  if (!path) return null;
  const raw = await Bun.file(path).text();
  return raw.replace('<head>', `<head>\n    ${buildEnvScript()}`);
}

// Initialize services
await originsService.initialize();
await notificationService.initialize();
await terminalService.initialize();
await masterSyncService.initialize();

// Seed test user
await seedTestUser();

const app = new Elysia()
  .use(cors({
    aot: false,
    origin: (request) => {
      if (process.env.CORS_ORIGIN === '*') return true;
      const origin = request.headers.get('origin');
      if (!origin) return true;
      return originsService.isAllowed(origin);
    },
    credentials: true,
  }))

  // Machine proxy — short-circuits requests with X-Machine-Id to paired masters.
  // Must run before any route so local handlers never see forwarded requests.
  .use(machineProxyPlugin)

  // API routes
  .use(api)

  // Internal routes (for hooks)
  .use(internalRoutes)

  // Terminal WebSocket routes
  .use(terminalWebsocketRoutes)

  // Browser preview WebSocket routes
  .use(previewWebsocketRoutes)

  // Health check
  .get('/health', () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }))

  // Serve index.html for root path (with runtime env injection)
  .get('/', async ({ set }) => {
    const html = await loadIndexHtml();
    if (!html) return { error: 'Not found' };
    set.headers['content-type'] = 'text/html';
    return html;
  })

  // Serve embedded UI assets, with SPA fallback to index.html
  .get('*', async ({ params, set }) => {
    const assetKey = `/${params['*'] ?? ''}`;
    const filePath = await getAssetPath(assetKey);
    if (filePath) {
      return new Response(Bun.file(filePath));
    }
    const html = await loadIndexHtml();
    if (!html) return { error: 'Not found' };
    set.headers['content-type'] = 'text/html';
    return html;
  })

  .onError(({ code, error, set }) => {
    console.error(`Error [${code}]:`, error);

    if (code === 'NOT_FOUND') {
      set.status = 404;
      return { error: 'Not found' };
    }

    if (code === 'VALIDATION') {
      set.status = 400;
      return { error: 'Validation error', details: error.message };
    }

    set.status = 500;
    return { error: 'Internal server error' };
  })

  .listen(PORT);

console.log(`
🚀 Remote Agent API running at http://localhost:${PORT}

Endpoints:
  - API:        http://localhost:${PORT}/api
  - Terminal:   ws://localhost:${PORT}/ws/terminal/:terminalId
  - Preview:    ws://localhost:${PORT}/ws/preview/:previewId
  - Health:     http://localhost:${PORT}/health
  - UI:         http://localhost:${PORT} (mode: ${uiServingMode})
`);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await masterSyncService.shutdown();
  await codeServerManager.shutdown();
  await browserPreviewService.shutdown();
  await notificationService.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await masterSyncService.shutdown();
  await codeServerManager.shutdown();
  await browserPreviewService.shutdown();
  await notificationService.shutdown();
  process.exit(0);
});

export type App = typeof app;
