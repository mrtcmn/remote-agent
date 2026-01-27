import { BaseNotificationAdapter } from './base.adapter';
import type { NotificationPayload } from '../types';

interface WebhookConfig {
  url: string;
  headers?: Record<string, string>;
}

// In-memory store for user webhook configs (could be moved to DB)
const userWebhooks = new Map<string, WebhookConfig>();

export class WebhookAdapter extends BaseNotificationAdapter {
  readonly name = 'webhook';

  async isConfigured(userId: string): Promise<boolean> {
    return userWebhooks.has(userId);
  }

  async send(userId: string, payload: NotificationPayload): Promise<boolean> {
    const config = userWebhooks.get(userId);
    if (!config) {
      return false;
    }

    try {
      const response = await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...config.headers,
        },
        body: JSON.stringify({
          event: 'notification',
          timestamp: new Date().toISOString(),
          userId,
          payload: {
            ...payload,
            title: this.formatTitle(payload),
            body: this.formatBody(payload),
          },
        }),
      });

      return response.ok;
    } catch (error) {
      console.error('Failed to send webhook notification:', error);
      return false;
    }
  }

  // Helper to register webhook for a user
  static registerWebhook(userId: string, config: WebhookConfig): void {
    userWebhooks.set(userId, config);
  }

  static unregisterWebhook(userId: string): void {
    userWebhooks.delete(userId);
  }
}
