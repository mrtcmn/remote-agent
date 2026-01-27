import admin from 'firebase-admin';
import { eq } from 'drizzle-orm';
import { db, fcmTokens } from '../../../db';
import { BaseNotificationAdapter } from './base.adapter';
import type { NotificationPayload } from '../types';

export class FirebaseAdapter extends BaseNotificationAdapter {
  readonly name = 'firebase';
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

    if (!projectId || !privateKey || !clientEmail) {
      console.warn('Firebase credentials not configured, push notifications disabled');
      return;
    }

    try {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          privateKey,
          clientEmail,
        }),
      });
      this.initialized = true;
      console.log('Firebase Admin initialized');
    } catch (error) {
      console.error('Failed to initialize Firebase:', error);
    }
  }

  async isConfigured(userId: string): Promise<boolean> {
    if (!this.initialized) return false;

    const tokens = await db.query.fcmTokens.findMany({
      where: eq(fcmTokens.userId, userId),
    });

    return tokens.length > 0;
  }

  async send(userId: string, payload: NotificationPayload): Promise<boolean> {
    if (!this.initialized) {
      console.warn('Firebase not initialized, skipping notification');
      return false;
    }

    const tokens = await db.query.fcmTokens.findMany({
      where: eq(fcmTokens.userId, userId),
    });

    if (tokens.length === 0) {
      console.warn(`No FCM tokens found for user ${userId}`);
      return false;
    }

    const message: admin.messaging.MulticastMessage = {
      tokens: tokens.map(t => t.token),
      notification: {
        title: this.formatTitle(payload),
        body: this.formatBody(payload),
      },
      data: {
        sessionId: payload.sessionId,
        type: payload.type,
        ...(payload.metadata ? { metadata: JSON.stringify(payload.metadata) } : {}),
      },
      webpush: {
        fcmOptions: {
          link: `/sessions/${payload.sessionId}`,
        },
        notification: {
          icon: '/icon-192.png',
          badge: '/badge-72.png',
          requireInteraction: payload.type === 'user_input_required',
          actions: payload.actions?.map(a => ({
            action: a.action,
            title: a.label,
          })),
        },
      },
      android: {
        priority: payload.priority === 'high' ? 'high' : 'normal',
        notification: {
          channelId: payload.type === 'user_input_required' ? 'urgent' : 'default',
          priority: payload.priority === 'high' ? 'high' : 'default',
        },
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: this.formatTitle(payload),
              body: this.formatBody(payload),
            },
            sound: payload.priority === 'high' ? 'default' : undefined,
            badge: 1,
          },
        },
      },
    };

    try {
      const response = await admin.messaging().sendEachForMulticast(message);

      // Remove invalid tokens
      if (response.failureCount > 0) {
        const invalidTokens: string[] = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const errorCode = resp.error?.code;
            if (
              errorCode === 'messaging/invalid-registration-token' ||
              errorCode === 'messaging/registration-token-not-registered'
            ) {
              invalidTokens.push(tokens[idx].token);
            }
          }
        });

        // Clean up invalid tokens
        if (invalidTokens.length > 0) {
          for (const token of invalidTokens) {
            await db.delete(fcmTokens).where(eq(fcmTokens.token, token));
          }
        }
      }

      return response.successCount > 0;
    } catch (error) {
      console.error('Failed to send Firebase notification:', error);
      return false;
    }
  }

  async shutdown(): Promise<void> {
    // Firebase Admin SDK doesn't require explicit cleanup
  }
}
