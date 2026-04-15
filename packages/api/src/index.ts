import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { staticPlugin } from '@elysiajs/static';
import { api, internalRoutes } from './routes';
import { terminalWebsocketRoutes } from './routes/terminal-websocket';
import { notificationService } from './services/notification';
import { terminalService } from './services/terminal';
import { originsService } from './services/origins';
import { seedTestUser } from './auth/seed';
import { isLocalMode, isRemoteMode } from './config/mode';
import { getDefaultPort } from './config/paths';
import { findAvailablePort } from './config/port';

// Remote-only imports (lazy loaded)
let browserPreviewService: { shutdown: () => Promise<void> } | null = null;
let codeServerManager: { shutdown: () => Promise<void> } | null = null;
let previewWebsocketRoutes: any = null;

if (isRemoteMode()) {
  const browserMod = await import('./services/browser-preview');
  browserPreviewService = browserMod.browserPreviewService;
  const codeMod = await import('./services/code-server/code-server.service');
  codeServerManager = codeMod.codeServerManager;
  const previewMod = await import('./routes/preview-websocket');
  previewWebsocketRoutes = previewMod.previewWebsocketRoutes;
}

// Resolve port
const defaultPort = getDefaultPort();
const PORT = isLocalMode() ? await findAvailablePort(defaultPort) : defaultPort;

// Set REMOTE_AGENT_API so hooks and child processes know our URL
process.env.REMOTE_AGENT_API = process.env.REMOTE_AGENT_API || `http://localhost:${PORT}`;

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
  const env: Record<string, string> = {
    VITE_AGENT_MODE: isLocalMode() ? 'local' : 'remote',
  };
  for (const key of CLIENT_ENV_KEYS) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return `<script>window.__ENV__=${JSON.stringify(env)}</script>`;
}

const indexHtml = rawHtml.replace('<head>', `<head>\n    ${buildEnvScript()}`);

// Initialize local directories if needed
if (isLocalMode()) {
  const { initLocal } = await import('./config/init-local');
  await initLocal();
}

// Initialize services
await originsService.initialize();
await notificationService.initialize();
await terminalService.initialize();

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

  // API routes
  .use(api)

  // Internal routes (for hooks)
  .use(internalRoutes)

  // Terminal WebSocket routes
  .use(terminalWebsocketRoutes);

// Browser preview WebSocket routes (remote only)
if (previewWebsocketRoutes) {
  app.use(previewWebsocketRoutes);
}

app
  // Health check
  .get('/health', () => ({
    status: 'ok',
    mode: isLocalMode() ? 'local' : 'remote',
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

const modeLabel = isLocalMode() ? 'LOCAL' : 'REMOTE';
console.log(`
🚀 Remote Agent API running in ${modeLabel} mode at http://localhost:${PORT}

Endpoints:
  - API:        http://localhost:${PORT}/api
  - Terminal:   ws://localhost:${PORT}/ws/terminal/:terminalId${isRemoteMode() ? `\n  - Preview:    ws://localhost:${PORT}/ws/preview/:previewId` : ''}
  - Health:     http://localhost:${PORT}/health
  - UI:         http://localhost:${PORT}
`);

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down...');
  if (codeServerManager) await codeServerManager.shutdown();
  if (browserPreviewService) await browserPreviewService.shutdown();
  await notificationService.shutdown();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export type App = typeof app;
