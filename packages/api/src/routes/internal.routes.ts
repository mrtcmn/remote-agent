import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, claudeSessions } from '../db';
import { notificationService } from '../services/notification';
import type { NotificationType } from '../services/notification/types';

// Internal routes for hooks (not authenticated, only accessible from localhost)
export const internalRoutes = new Elysia({ prefix: '/internal' })
  .onBeforeHandle(({ request, set }) => {
    // Only allow requests from localhost
    const host = request.headers.get('host') || '';
    if (!host.includes('localhost') && !host.includes('127.0.0.1')) {
      set.status = 403;
      return { error: 'Forbidden' };
    }
  })

  // Hook callback for notifications
  .post('/hooks/attention', async ({ body, set }) => {
    console.log('hooks/attention', body);
    const session = await db.query.claudeSessions.findFirst({
      where: eq(claudeSessions.id, body.sessionId),
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    // Update session status
    await db.update(claudeSessions)
      .set({ status: 'waiting_input' })
      .where(eq(claudeSessions.id, body.sessionId));

    // Send notification
    const result = await notificationService.notify(session.userId, {
      sessionId: body.sessionId,
      type: body.type as NotificationType,
      title: body.type === 'task_complete' ? 'Task Complete' : 'Attention Required',
      body: body.prompt,
      priority: body.type === 'task_complete' ? 'normal' : 'high',
    });

    return { success: true, notification: result };
  }, {
    body: t.Object({
      sessionId: t.String(),
      type: t.String(),
      prompt: t.String(),
    }),
  });
