import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { staticPlugin } from '@elysiajs/static';
import { api, internalRoutes } from './routes';
import { terminalWebsocketRoutes } from './routes/terminal-websocket';
import { notificationService } from './services/notification';
import { terminalService } from './services/terminal';
import { seedTestUser } from './auth/seed';

const PORT = process.env.PORT || 5100;

// Initialize services
await notificationService.initialize();
await terminalService.initialize();

// Seed test user
await seedTestUser();

const corsOrigin = process.env.CORS_ORIGIN === '*'
  ? true
  : (process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173', 'http://localhost:5100']);

const app = new Elysia()
  .use(cors({
    origin: corsOrigin,
    credentials: true,
  }))

  // API routes
  .use(api)

  // Internal routes (for hooks)
  .use(internalRoutes)

  // Terminal WebSocket routes
  .use(terminalWebsocketRoutes)

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

  // Serve index.html for root path
  .get('/', async ({ set }) => {
    const file = Bun.file('../ui/dist/index.html');
    if (await file.exists()) {
      set.headers['content-type'] = 'text/html';
      return file;
    }
    return { error: 'Not found' };
  })

  // Fallback to index.html for SPA routing (client-side routes)
  .get('*', async ({ set }) => {
    const file = Bun.file('../ui/dist/index.html');
    if (await file.exists()) {
      set.headers['content-type'] = 'text/html';
      return file;
    }
    return { error: 'Not found' };
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
  - Health:     http://localhost:${PORT}/health
  - UI:         http://localhost:${PORT}
`);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await notificationService.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await notificationService.shutdown();
  process.exit(0);
});

export type App = typeof app;
