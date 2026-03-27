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
import { fileRoutes } from './files.routes';
import { kanbanRoutes } from './kanban.routes';
import { settingsRoutes } from './settings.routes';
import { runConfigRoutes } from './run-configs.routes';
import { presenceRoutes } from './presence.routes';
import { previewRoutes } from './preview.routes';
import { dockerRoutes } from './docker.routes';
import { editorRoutes } from './editor.routes';
import { skillsRoutes } from './skills.routes';
import { mcpRoutes } from './mcp.routes';
import { artifactRoutes } from './artifacts.routes';
import { presentationRoutes } from './presentation.routes';

export const api = new Elysia({ prefix: '/api' })
  .use(authRoutes)
  .use(sessionRoutes)
  .use(projectRoutes)
  .use(notificationRoutes)
  .use(workspaceRoutes)
  .use(terminalRoutes)
  .use(reviewCommentsRoutes)
  .use(fileRoutes)
  .use(kanbanRoutes)
  .use(settingsRoutes)
  .use(runConfigRoutes)
  .use(previewRoutes)
  .use(dockerRoutes)
  .use(editorRoutes)
  .use(skillsRoutes)
  .use(mcpRoutes)
  .use(presenceRoutes)
  .use(artifactRoutes)
  .use(presentationRoutes)
  .use(versionRoutes);

export { internalRoutes };
export { terminalRoutes } from './terminals.routes';
