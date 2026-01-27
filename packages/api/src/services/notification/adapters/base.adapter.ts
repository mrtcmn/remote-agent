import type { NotificationAdapter, NotificationPayload } from '../types';

export abstract class BaseNotificationAdapter implements NotificationAdapter {
  abstract readonly name: string;

  abstract send(userId: string, payload: NotificationPayload): Promise<boolean>;

  abstract isConfigured(userId: string): Promise<boolean>;

  async initialize(): Promise<void> {
    // Override in subclass if needed
  }

  async shutdown(): Promise<void> {
    // Override in subclass if needed
  }

  protected formatTitle(payload: NotificationPayload): string {
    const prefix = payload.projectName ? `[${payload.projectName}] ` : '';
    return `${prefix}${payload.title}`;
  }

  protected formatBody(payload: NotificationPayload): string {
    return payload.body;
  }
}
