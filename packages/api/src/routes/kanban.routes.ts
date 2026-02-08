import { Elysia, t } from 'elysia';
import { requireAuth } from '../auth/middleware';
import { kanbanService } from '../services/kanban';
import { autoFlowService } from '../services/auto-flow';
import { cliAdapterRegistry } from '../services/cli-adapter';
import { nanoid } from 'nanoid';
import { join } from 'path';
import { mkdir } from 'fs/promises';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

export const kanbanRoutes = new Elysia({ prefix: '/kanban' })
  .use(requireAuth)

  // ─── Board ────────────────────────────────────────────────────────────

  // Get board data (columns with tasks grouped by status)
  .get('/board', async ({ user, query }) => {
    return kanbanService.getBoardData(user!.id, query.projectId);
  }, {
    query: t.Object({
      projectId: t.Optional(t.String()),
    }),
  })

  // Get all statuses
  .get('/statuses', async () => {
    return kanbanService.getStatuses();
  })

  // ─── Tasks ────────────────────────────────────────────────────────────

  // List tasks with filtering
  .get('/tasks', async ({ user, query }) => {
    const filters: Record<string, any> = {};
    if (query.projectId) filters.projectId = query.projectId;
    if (query.status) filters.status = query.status.includes(',') ? query.status.split(',') : query.status;
    if (query.priority) filters.priority = query.priority.includes(',') ? query.priority.split(',') : query.priority;
    if (query.assigneeType) filters.assigneeType = query.assigneeType;
    if (query.assigneeId) filters.assigneeId = query.assigneeId;
    if (query.sessionId) filters.sessionId = query.sessionId;
    if (query.search) filters.search = query.search;
    if (query.parentTaskId) filters.parentTaskId = query.parentTaskId;
    if (query.topLevel === 'true') filters.parentTaskId = null;

    return kanbanService.getTasks(user!.id, {
      filters,
      limit: query.limit ? parseInt(query.limit) : undefined,
      offset: query.offset ? parseInt(query.offset) : undefined,
    });
  }, {
    query: t.Object({
      projectId: t.Optional(t.String()),
      status: t.Optional(t.String()),
      priority: t.Optional(t.String()),
      assigneeType: t.Optional(t.String()),
      assigneeId: t.Optional(t.String()),
      sessionId: t.Optional(t.String()),
      search: t.Optional(t.String()),
      parentTaskId: t.Optional(t.String()),
      topLevel: t.Optional(t.String()),
      limit: t.Optional(t.String()),
      offset: t.Optional(t.String()),
    }),
  })

  // Get single task
  .get('/tasks/:id', async ({ user, params, set }) => {
    const task = await kanbanService.getTask(params.id, user!.id);
    if (!task) {
      set.status = 404;
      return { error: 'Task not found' };
    }
    return task;
  }, {
    params: t.Object({ id: t.String() }),
  })

  // Create task
  .post('/tasks', async ({ user, body, set }) => {
    try {
      return await kanbanService.createTask(user!.id, body);
    } catch (error) {
      set.status = 400;
      return { error: (error as Error).message };
    }
  }, {
    body: t.Object({
      projectId: t.String(),
      title: t.String(),
      description: t.Optional(t.String()),
      status: t.Optional(t.String()),
      priority: t.Optional(t.String()),
      parentTaskId: t.Optional(t.String()),
      assigneeType: t.Optional(t.String()),
      assigneeId: t.Optional(t.String()),
      autoFlow: t.Optional(t.Boolean()),
      adapterType: t.Optional(t.String()),
      labels: t.Optional(t.Array(t.String())),
      branch: t.Optional(t.String()),
      githubIssueNumber: t.Optional(t.Number()),
      githubIssueUrl: t.Optional(t.String()),
    }),
  })

  // Update task
  .patch('/tasks/:id', async ({ user, params, body, set }) => {
    try {
      const task = await kanbanService.updateTask(params.id, user!.id, body);
      if (!task) {
        set.status = 404;
        return { error: 'Task not found' };
      }
      return task;
    } catch (error) {
      set.status = 400;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      title: t.Optional(t.String()),
      description: t.Optional(t.String()),
      status: t.Optional(t.String()),
      priority: t.Optional(t.String()),
      position: t.Optional(t.Number()),
      parentTaskId: t.Optional(t.Nullable(t.String())),
      assigneeType: t.Optional(t.String()),
      assigneeId: t.Optional(t.Nullable(t.String())),
      sessionId: t.Optional(t.Nullable(t.String())),
      autoFlow: t.Optional(t.Boolean()),
      adapterType: t.Optional(t.String()),
      labels: t.Optional(t.Array(t.String())),
      branch: t.Optional(t.String()),
      githubIssueNumber: t.Optional(t.Number()),
      githubIssueUrl: t.Optional(t.String()),
      estimatedEffort: t.Optional(t.String()),
    }),
  })

  // Move task (change status and/or position - for drag and drop)
  .post('/tasks/:id/move', async ({ user, params, body, set }) => {
    try {
      const task = await kanbanService.moveTask(params.id, user!.id, body.status, body.position);

      // Trigger auto-flow if task completed
      if (body.status === 'completed') {
        autoFlowService.onTaskCompleted(params.id, user!.id).catch(err => {
          console.error('[kanban] Auto-flow trigger error:', err);
        });
      }

      return task;
    } catch (error) {
      set.status = 400;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      status: t.String(),
      position: t.Number(),
    }),
  })

  // Delete task
  .delete('/tasks/:id', async ({ user, params, set }) => {
    try {
      return await kanbanService.deleteTask(params.id, user!.id);
    } catch (error) {
      set.status = 400;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({ id: t.String() }),
  })

  // ─── Dependencies ──────────────────────────────────────────────────────

  .post('/tasks/:id/dependencies', async ({ params, body, set }) => {
    try {
      return await kanbanService.addDependency(params.id, body.dependsOnTaskId);
    } catch (error) {
      set.status = 400;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ dependsOnTaskId: t.String() }),
  })

  .delete('/dependencies/:id', async ({ params }) => {
    return kanbanService.removeDependency(params.id);
  }, {
    params: t.Object({ id: t.String() }),
  })

  // ─── Comments ──────────────────────────────────────────────────────────

  .get('/tasks/:id/comments', async ({ params }) => {
    return kanbanService.getComments(params.id);
  }, {
    params: t.Object({ id: t.String() }),
  })

  .post('/tasks/:id/comments', async ({ user, params, body }) => {
    return kanbanService.addComment(params.id, user!.id, body.content, body.parentCommentId);
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      content: t.String(),
      parentCommentId: t.Optional(t.String()),
    }),
  })

  .post('/comments/:id/resolve', async ({ user, params }) => {
    return kanbanService.resolveComment(params.id, user!.id);
  }, {
    params: t.Object({ id: t.String() }),
  })

  .post('/comments/:id/reject', async ({ user, params }) => {
    return kanbanService.rejectComment(params.id, user!.id);
  }, {
    params: t.Object({ id: t.String() }),
  })

  .post('/comments/:id/reopen', async ({ params }) => {
    return kanbanService.reopenComment(params.id);
  }, {
    params: t.Object({ id: t.String() }),
  })

  .delete('/comments/:id', async ({ params }) => {
    return kanbanService.deleteComment(params.id);
  }, {
    params: t.Object({ id: t.String() }),
  })

  // ─── Attachments ────────────────────────────────────────────────────────

  .post('/tasks/:id/attachments', async ({ user, params, body, set }) => {
    try {
      const file = body.file;
      if (!file) {
        set.status = 400;
        return { error: 'No file provided' };
      }

      // Validate file size (10MB max)
      if (file.size > 10 * 1024 * 1024) {
        set.status = 400;
        return { error: 'File too large (max 10MB)' };
      }

      // Create upload directory
      const taskUploadDir = join(UPLOAD_DIR, 'kanban', params.id);
      await mkdir(taskUploadDir, { recursive: true });

      // Save file
      const ext = file.name.split('.').pop() || '';
      const savedFilename = `${nanoid()}.${ext}`;
      const filepath = join(taskUploadDir, savedFilename);
      await Bun.write(filepath, file);

      return await kanbanService.addAttachment({
        taskId: params.id,
        commentId: body.commentId || undefined,
        userId: user!.id,
        filename: file.name,
        filepath,
        mimetype: file.type,
        size: file.size,
      });
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      file: t.File(),
      commentId: t.Optional(t.String()),
    }),
  })

  .delete('/attachments/:id', async ({ params }) => {
    return kanbanService.deleteAttachment(params.id);
  }, {
    params: t.Object({ id: t.String() }),
  })

  // Serve attachment files
  .get('/attachments/:id/file', async ({ params, set }) => {
    const { db } = await import('../db');
    const { kanbanTaskAttachments } = await import('../db');
    const { eq } = await import('drizzle-orm');

    const attachment = await db.query.kanbanTaskAttachments.findFirst({
      where: eq(kanbanTaskAttachments.id, params.id),
    });

    if (!attachment) {
      set.status = 404;
      return { error: 'Attachment not found' };
    }

    const file = Bun.file(attachment.filepath);
    if (!await file.exists()) {
      set.status = 404;
      return { error: 'File not found on disk' };
    }

    set.headers['content-type'] = attachment.mimetype;
    set.headers['content-disposition'] = `inline; filename="${attachment.filename}"`;
    return file;
  }, {
    params: t.Object({ id: t.String() }),
  })

  // ─── Auto-Flows ────────────────────────────────────────────────────────

  .get('/flows', async ({ user, query }) => {
    return autoFlowService.getFlows(user!.id, query.projectId);
  }, {
    query: t.Object({
      projectId: t.Optional(t.String()),
    }),
  })

  .get('/flows/:id', async ({ user, params, set }) => {
    const flow = await autoFlowService.getFlow(params.id, user!.id);
    if (!flow) {
      set.status = 404;
      return { error: 'Flow not found' };
    }
    return flow;
  }, {
    params: t.Object({ id: t.String() }),
  })

  .post('/flows', async ({ user, body, set }) => {
    try {
      return await autoFlowService.createFlow(user!.id, body);
    } catch (error) {
      set.status = 400;
      return { error: (error as Error).message };
    }
  }, {
    body: t.Object({
      projectId: t.String(),
      name: t.String(),
      description: t.Optional(t.String()),
      triggerType: t.Optional(t.String()),
      cronExpression: t.Optional(t.String()),
      adapterType: t.Optional(t.String()),
      adapterConfig: t.Optional(t.Any()),
      taskIds: t.Optional(t.Array(t.String())),
    }),
  })

  .patch('/flows/:id', async ({ user, params, body, set }) => {
    try {
      return await autoFlowService.updateFlow(params.id, user!.id, body);
    } catch (error) {
      set.status = 400;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      name: t.Optional(t.String()),
      description: t.Optional(t.String()),
      triggerType: t.Optional(t.String()),
      cronExpression: t.Optional(t.String()),
      adapterType: t.Optional(t.String()),
      adapterConfig: t.Optional(t.Any()),
      enabled: t.Optional(t.Boolean()),
    }),
  })

  .delete('/flows/:id', async ({ user, params }) => {
    return autoFlowService.deleteFlow(params.id, user!.id);
  }, {
    params: t.Object({ id: t.String() }),
  })

  .post('/flows/:id/steps', async ({ params, body }) => {
    return autoFlowService.addFlowStep(params.id, body.taskId, body.adapterType);
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      taskId: t.String(),
      adapterType: t.Optional(t.String()),
    }),
  })

  .delete('/flow-steps/:id', async ({ params }) => {
    return autoFlowService.removeFlowStep(params.id);
  }, {
    params: t.Object({ id: t.String() }),
  })

  // ─── CLI Adapters ───────────────────────────────────────────────────────

  .get('/adapters', async () => {
    const all = cliAdapterRegistry.getAll();
    const available = await cliAdapterRegistry.getAvailable();
    return all.map(a => ({
      name: a.name,
      type: a.type,
      available: available.some(av => av.type === a.type),
    }));
  });
