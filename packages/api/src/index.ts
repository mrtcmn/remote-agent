import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { staticPlugin } from '@elysiajs/static';
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

const PORT = process.env.PORT || 5100;

// Runtime env injection for the frontend
const HTML_PATH = '../ui/dist/index.html';
const htmlFile = Bun.file(HTML_PATH);
const rawHtml = await htmlFile.exists() ? await htmlFile.text() : '';

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

const indexHtml = rawHtml.replace('<head>', `<head>\n    ${buildEnvScript()}`);

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

  // Serve static UI files in production
  .use(staticPlugin({
    assets: '../ui/dist',
    prefix: '/',
  }))

  // Serve index.html for root path (with runtime env injection)
  .get('/', ({ set }) => {
    if (!indexHtml) return { error: 'Not found' };
    set.headers['content-type'] = 'text/html';
    return indexHtml;
  })

  // Fallback to index.html for SPA routing (client-side routes)
  .get('*', ({ set }) => {
    if (!indexHtml) return { error: 'Not found' };
    set.headers['content-type'] = 'text/html';
    return indexHtml;
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
  - UI:         http://localhost:${PORT}
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
