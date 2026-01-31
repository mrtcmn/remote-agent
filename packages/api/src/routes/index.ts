import { Elysia } from 'elysia';
import { authRoutes } from './auth.routes';
import { sessionRoutes } from './sessions.routes';
import { projectRoutes } from './projects.routes';
import { notificationRoutes } from './notifications.routes';
import { workspaceRoutes } from './workspace.routes';
import { terminalRoutes } from './terminals.routes';
import { internalRoutes } from './internal.routes';
import { versionRoutes } from './version.routes';
import { reviewCommentsRoutes } from './review-comments.routes';

export const api = new Elysia({ prefix: '/api' })
  .use(authRoutes)
  .use(sessionRoutes)
  .use(projectRoutes)
  .use(notificationRoutes)
  .use(workspaceRoutes)
  .use(terminalRoutes)
  .use(reviewCommentsRoutes)
  .use(versionRoutes);

export { internalRoutes };
export { terminalRoutes } from './terminals.routes';
