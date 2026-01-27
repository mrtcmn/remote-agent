import { eq } from 'drizzle-orm';
import { db, notificationPrefs } from '../../db';
import type { NotificationAdapter, NotificationPayload } from './types';
import { FirebaseAdapter, WebhookAdapter } from './adapters';

export class NotificationService {
  private adapters = new Map<string, NotificationAdapter>();
  private initialized = false;

  constructor() {
    // Register default adapters
    this.registerAdapter(new FirebaseAdapter());
    this.registerAdapter(new WebhookAdapter());
  }

  registerAdapter(adapter: NotificationAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  getAdapter(name: string): NotificationAdapter | undefined {
    return this.adapters.get(name);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    for (const adapter of this.adapters.values()) {
      if (adapter.initialize) {
        await adapter.initialize();
      }
    }

    this.initialized = true;
    console.log(`NotificationService initialized with adapters: ${[...this.adapters.keys()].join(', ')}`);
  }

  async shutdown(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      if (adapter.shutdown) {
        await adapter.shutdown();
      }
    }
  }

  async notify(userId: string, payload: NotificationPayload): Promise<{ success: boolean; results: Record<string, boolean> }> {
    const prefs = await this.getUserPreferences(userId);
    const enabledAdapters = this.parseEnabledAdapters(prefs?.enabledAdapters);

    // Check quiet hours
    if (prefs && this.isQuietHours(prefs.quietHoursStart, prefs.quietHoursEnd)) {
      if (payload.priority !== 'high') {
        console.log(`Skipping notification for ${userId} - quiet hours`);
        return { success: false, results: {} };
      }
    }

    // Check notification type preferences
    if (prefs) {
      if (payload.type === 'user_input_required' && !prefs.notifyOnInput) {
        return { success: false, results: {} };
      }
      if (payload.type === 'error' && !prefs.notifyOnError) {
        return { success: false, results: {} };
      }
      if (payload.type === 'task_complete' && !prefs.notifyOnComplete) {
        return { success: false, results: {} };
      }
    }

    const results: Record<string, boolean> = {};
    let anySuccess = false;

    for (const adapterName of enabledAdapters) {
      const adapter = this.adapters.get(adapterName);
      if (!adapter) {
        console.warn(`Adapter ${adapterName} not found`);
        results[adapterName] = false;
        continue;
      }

      const isConfigured = await adapter.isConfigured(userId);
      if (!isConfigured) {
        console.warn(`Adapter ${adapterName} not configured for user ${userId}`);
        results[adapterName] = false;
        continue;
      }

      try {
        const success = await adapter.send(userId, payload);
        results[adapterName] = success;
        if (success) anySuccess = true;
      } catch (error) {
        console.error(`Error sending notification via ${adapterName}:`, error);
        results[adapterName] = false;
      }
    }

    return { success: anySuccess, results };
  }

  private async getUserPreferences(userId: string) {
    return db.query.notificationPrefs.findFirst({
      where: eq(notificationPrefs.userId, userId),
    });
  }

  private parseEnabledAdapters(json: string | null | undefined): string[] {
    if (!json) return ['firebase'];
    try {
      return JSON.parse(json);
    } catch {
      return ['firebase'];
    }
  }

  private isQuietHours(start: string | null, end: string | null): boolean {
    if (!start || !end) return false;

    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    const [startHour, startMin] = start.split(':').map(Number);
    const [endHour, endMin] = end.split(':').map(Number);

    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;

    if (startTime <= endTime) {
      return currentTime >= startTime && currentTime <= endTime;
    } else {
      // Quiet hours span midnight
      return currentTime >= startTime || currentTime <= endTime;
    }
  }
}

// Singleton instance
export const notificationService = new NotificationService();
