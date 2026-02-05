import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, claudeSessions } from '../db';
import { notificationService } from '../services/notification';
import type { NotificationType, NotificationAction } from '../services/notification/types';

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

  // Hook callback for attention notifications (idle_prompt, permission_prompt)
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

    // Define actions based on type
    const actions: NotificationAction[] = body.type === 'permission_request'
      ? [
          { label: 'Approve', action: 'approve' },
          { label: 'Deny', action: 'deny' },
        ]
      : [
          { label: 'Open', action: 'open' },
          { label: 'Reply', action: 'reply' },
        ];

    // Create and send notification
    const result = await notificationService.createAndSend({
      userId: session.userId,
      sessionId: body.sessionId,
      terminalId: body.terminalId,
      type: body.type as NotificationType,
      title: body.type === 'permission_request' ? 'Permission Request' : 'Attention Required',
      body: body.prompt,
      actions,
      priority: 'high',
    });

    return {
      success: true,
      notificationId: result.notification.id,
      notification: result.sendResult,
    };
  }, {
    body: t.Object({
      sessionId: t.String(),
      terminalId: t.Optional(t.String()),
      type: t.String(),
      prompt: t.String(),
    }),
  })

  // Hook callback for task completion (Stop event)
  .post('/hooks/complete', async ({ body, set }) => {
    console.log('hooks/complete', body);
    const session = await db.query.claudeSessions.findFirst({
      where: eq(claudeSessions.id, body.sessionId),
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    // Update session status to terminated (task complete)
    await db.update(claudeSessions)
      .set({ status: 'terminated' })
      .where(eq(claudeSessions.id, body.sessionId));

    // Create and send notification
    const result = await notificationService.createAndSend({
      userId: session.userId,
      sessionId: body.sessionId,
      terminalId: body.terminalId,
      type: 'task_complete' as NotificationType,
      title: 'Task Complete',
      body: body.prompt,
      actions: [{ label: 'View', action: 'view' }],
      priority: 'normal',
    });

    return {
      success: true,
      notificationId: result.notification.id,
      notification: result.sendResult,
    };
  }, {
    body: t.Object({
      sessionId: t.String(),
      terminalId: t.Optional(t.String()),
      type: t.String(),
      prompt: t.String(),
    }),
  });
