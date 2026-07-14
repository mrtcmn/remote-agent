import { Elysia, t } from 'elysia';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db, fcmTokens, notificationPrefs } from '../db';
import { requireAuth } from '../auth/middleware';
import { notificationRepository, notificationService } from '../services/notification';
import { fanOutToMasters } from '../services/aggregation/fan-out';
import { mergeNotifications } from '../services/aggregation/merge';

export const notificationRoutes = new Elysia({ prefix: '/notifications' })
  .use(requireAuth)

  // List notifications (inbox)
  .get('/', async ({ user, query }) => {
    const statusFilter = query.status?.split(',').filter(Boolean) as any[] | undefined;

    const notifications = await notificationRepository.findByUser(user!.id, {
      status: statusFilter,
      sessionId: query.sessionId,
      limit: query.limit ? parseInt(query.limit) : 50,
      offset: query.offset ? parseInt(query.offset) : 0,
    });

    return { notifications };
  }, {
    query: t.Object({
      status: t.Optional(t.String()), // comma-separated: pending,sent,read
      sessionId: t.Optional(t.String()),
      limit: t.Optional(t.String()),
      offset: t.Optional(t.String()),
    }),
  })

  // Aggregate notifications across self + all paired machines. Local-only: runs
  // here and fans out, merging each machine's inbox into one chronological list,
  // tagging every notification with its origin machine.
  .get('/aggregate', async ({ user, query }) => {
    const statusFilter = query.status?.split(',').filter(Boolean) as any[] | undefined;
    const limit = query.limit ? parseInt(query.limit) : 50;

    const selfNotifs = await notificationRepository.findByUser(user!.id, {
      status: statusFilter,
      limit,
      offset: 0,
    });
    const self = { machineId: 'self', machineName: 'This machine', online: true, data: selfNotifs };

    const qs = new URLSearchParams();
    if (query.status) qs.set('status', query.status);
    qs.set('limit', String(limit));
    const remoteRaw = await fanOutToMasters<{ notifications: typeof selfNotifs }>(
      user!.id,
      `/notifications?${qs.toString()}`,
    );
    const remotes = remoteRaw.map((r) => ({
      machineId: r.machineId,
      machineName: r.machineName,
      online: r.online,
      error: r.error,
      data: r.online && r.data ? r.data.notifications : null,
    }));

    const merged = mergeNotifications([self, ...remotes]);
    return { ...merged, notifications: merged.notifications.slice(0, limit) };
  }, {
    query: t.Object({
      status: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  })

  // Get unread count
  .get('/unread-count', async ({ user }) => {
    const count = await notificationRepository.getUnreadCount(user!.id);
    return { count };
  })

  // Register FCM token
  .post('/fcm/register', async ({ user, body }) => {
    const existingToken = await db.query.fcmTokens.findFirst({
      where: eq(fcmTokens.token, body.token),
    });

    if (existingToken) {
      // Update existing token
      await db.update(fcmTokens)
        .set({
          userId: user!.id,
          deviceName: body.deviceName,
          platform: body.platform || 'web',
        })
        .where(eq(fcmTokens.token, body.token));

      return { success: true, updated: true };
    }

    // Create new token
    await db.insert(fcmTokens).values({
      id: nanoid(),
      userId: user!.id,
      token: body.token,
      deviceName: body.deviceName,
      platform: body.platform || 'web',
      createdAt: new Date(),
    });

    return { success: true, created: true };
  }, {
    body: t.Object({
      token: t.String(),
      deviceName: t.Optional(t.String()),
      platform: t.Optional(t.Union([
        t.Literal('web'),
        t.Literal('android'),
        t.Literal('ios'),
      ])),
    }),
  })

  // Unregister FCM token
  .delete('/fcm/:token', async ({ user, params }) => {
    await db.delete(fcmTokens)
      .where(eq(fcmTokens.token, params.token));

    return { success: true };
  }, {
    params: t.Object({
      token: t.String(),
    }),
  })

  // List registered devices
  .get('/devices', async ({ user }) => {
    const tokens = await db.query.fcmTokens.findMany({
      where: eq(fcmTokens.userId, user!.id),
      columns: {
        id: true,
        deviceName: true,
        platform: true,
        createdAt: true,
      },
    });

    return tokens;
  })

  // Get notification preferences
  .get('/preferences', async ({ user }) => {
    const prefs = await db.query.notificationPrefs.findFirst({
      where: eq(notificationPrefs.userId, user!.id),
    });

    if (!prefs) {
      return {
        enabledAdapters: ['firebase'],
        quietHoursStart: null,
        quietHoursEnd: null,
        notifyOnInput: true,
        notifyOnError: true,
        notifyOnComplete: true,
      };
    }

    return {
      ...prefs,
      enabledAdapters: JSON.parse(prefs.enabledAdapters || '["firebase"]'),
    };
  })

  // Update notification preferences
  .put('/preferences', async ({ user, body }) => {
    const existing = await db.query.notificationPrefs.findFirst({
      where: eq(notificationPrefs.userId, user!.id),
    });

    const data = {
      enabledAdapters: body.enabledAdapters ? JSON.stringify(body.enabledAdapters) : undefined,
      quietHoursStart: body.quietHoursStart,
      quietHoursEnd: body.quietHoursEnd,
      notifyOnInput: body.notifyOnInput,
      notifyOnError: body.notifyOnError,
      notifyOnComplete: body.notifyOnComplete,
    };

    // Remove undefined values
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([_, v]) => v !== undefined)
    );

    if (existing) {
      await db.update(notificationPrefs)
        .set(cleanData)
        .where(eq(notificationPrefs.userId, user!.id));
    } else {
      await db.insert(notificationPrefs).values({
        userId: user!.id,
        ...cleanData,
      });
    }

    return { success: true };
  }, {
    body: t.Object({
      enabledAdapters: t.Optional(t.Array(t.String())),
      quietHoursStart: t.Optional(t.Union([t.String(), t.Null()])),
      quietHoursEnd: t.Optional(t.Union([t.String(), t.Null()])),
      notifyOnInput: t.Optional(t.Boolean()),
      notifyOnError: t.Optional(t.Boolean()),
      notifyOnComplete: t.Optional(t.Boolean()),
    }),
  })

  // Test notification
  .post('/test', async ({ user }) => {
    const { notificationService } = await import('../services/notification');

    const result = await notificationService.notify(user!.id, {
      sessionId: 'test',
      type: 'user_input_required',
      title: 'Test Notification',
      body: 'This is a test notification from Remote Agent.',
      priority: 'normal',
    });

    return result;
  })

  // Respond to notification (for mobile inline replies)
  .post('/:id/respond', async ({ user, params, body, set }) => {
    const result = await notificationService.respond(user!.id, params.id, body);

    if (!result.ok) {
      set.status = result.error === 'not_found' ? 404 : 403;
      return { error: result.error === 'not_found' ? 'Notification not found' : 'Forbidden' };
    }

    return { success: true, terminalWritten: result.terminalWritten };
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      action: t.String(),
      text: t.Optional(t.String()),
    }),
  })

  // Update notification status
  .patch('/:id', async ({ user, params, body, set }) => {
    const notification = await notificationRepository.findById(params.id);

    if (!notification) {
      set.status = 404;
      return { error: 'Notification not found' };
    }

    if (notification.userId !== user!.id) {
      set.status = 403;
      return { error: 'Forbidden' };
    }

    await notificationRepository.updateStatus(
      params.id,
      body.status,
      body.resolvedAction
    );

    return { success: true };
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      status: t.Union([
        t.Literal('read'),
        t.Literal('resolved'),
        t.Literal('dismissed'),
      ]),
      resolvedAction: t.Optional(t.String()),
    }),
  })

  // Bulk mark as read
  .post('/mark-read', async ({ user, body }) => {
    // Verify all notifications belong to user (simplified - just mark)
    await notificationRepository.markManyAsRead(body.ids);
    return { success: true };
  }, {
    body: t.Object({
      ids: t.Array(t.String()),
    }),
  })

  // Bulk dismiss by session or terminal
  .post('/dismiss', async ({ user, body }) => {
    let count = 0;

    if (body.sessionId) {
      count = await notificationRepository.dismissBySession(body.sessionId);
    } else if (body.terminalId) {
      count = await notificationRepository.dismissByTerminal(body.terminalId);
    }

    return { success: true, dismissed: count };
  }, {
    body: t.Object({
      sessionId: t.Optional(t.String()),
      terminalId: t.Optional(t.String()),
    }),
  });
