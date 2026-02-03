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
    const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

    if (!projectId || !rawPrivateKey || !clientEmail) {
      console.warn('Firebase credentials not configured, push notifications disabled');
      return;
    }

    // Parse and normalize the private key
    let privateKey = rawPrivateKey.trim();
    
    // Remove surrounding quotes if present
    if ((privateKey.startsWith('"') && privateKey.endsWith('"')) ||
        (privateKey.startsWith("'") && privateKey.endsWith("'"))) {
      privateKey = privateKey.slice(1, -1);
    }

    // Replace escaped newlines with actual newlines
    // Handle both \n and \\n patterns
    privateKey = privateKey.replace(/\\n/g, '\n');
    
    // Ensure the key has proper PEM formatting
    if (!privateKey.includes('-----BEGIN')) {
      console.error('Firebase private key is missing PEM header. Expected format: -----BEGIN PRIVATE KEY-----');
      return;
    }

    if (!privateKey.includes('-----END')) {
      console.error('Firebase private key is missing PEM footer. Expected format: -----END PRIVATE KEY-----');
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
      if (error instanceof Error) {
        console.error('Error details:', error.message);
        // Log first 100 chars of private key for debugging (without exposing full key)
        const keyPreview = privateKey.substring(0, 100).replace(/\n/g, '\\n');
        console.error('Private key preview (first 100 chars):', keyPreview);
      }
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

    console.log('[Firebase] Sending notification:', {
      userId,
      tokenCount: tokens.length,
      title: message.notification?.title,
      body: message.notification?.body,
      data: message.data,
      type: payload.type,
    });

    try {
      const response = await admin.messaging().sendEachForMulticast(message);

      console.log('[Firebase] Send response:', {
        successCount: response.successCount,
        failureCount: response.failureCount,
        responses: response.responses.map((r, i) => ({
          index: i,
          success: r.success,
          messageId: r.messageId,
          error: r.error ? { code: r.error.code, message: r.error.message } : null,
        })),
      });

      // Remove invalid tokens
      if (response.failureCount > 0) {
        const invalidTokens: string[] = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const errorCode = resp.error?.code;
            console.log(`[Firebase] Token ${idx} failed:`, {
              code: errorCode,
              message: resp.error?.message,
            });
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
          console.log(`[Firebase] Removing ${invalidTokens.length} invalid tokens`);
          for (const token of invalidTokens) {
            await db.delete(fcmTokens).where(eq(fcmTokens.token, token));
          }
        }
      }

      return response.successCount > 0;
    } catch (error) {
      console.error('[Firebase] Failed to send notification:', error);
      return false;
    }
  }

  async shutdown(): Promise<void> {
    // Firebase Admin SDK doesn't require explicit cleanup
  }
}
