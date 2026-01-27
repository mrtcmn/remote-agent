import { Elysia } from 'elysia';
import { authRoutes } from './auth.routes';
import { sessionRoutes } from './sessions.routes';
import { projectRoutes } from './projects.routes';
import { notificationRoutes } from './notifications.routes';
import { workspaceRoutes } from './workspace.routes';
import { internalRoutes } from './internal.routes';
import { websocketRoutes } from './websocket';

export const api = new Elysia({ prefix: '/api' })
  .use(authRoutes)
  .use(sessionRoutes)
  .use(projectRoutes)
  .use(notificationRoutes)
  .use(workspaceRoutes);

export { websocketRoutes, internalRoutes };
