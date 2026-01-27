import { Elysia, t } from 'elysia';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db, fcmTokens, notificationPrefs } from '../db';
import { requireAuth } from '../auth/middleware';

export const notificationRoutes = new Elysia({ prefix: '/notifications' })
  .use(requireAuth)

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
  });
