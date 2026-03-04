import { eq } from 'drizzle-orm';
import { db, notificationPrefs } from '../../db';
import type { NotificationAdapter, NotificationPayload, CreateNotificationInput, NotificationRecord } from './types';
import { FirebaseAdapter, WebhookAdapter } from './adapters';
import { notificationRepository } from './notification.repository';

export class NotificationService {
  private adapters = new Map<string, NotificationAdapter>();
  private initialized = false;
  // Debounce: track recently sent notification content per user to avoid duplicates
  // Key: `${userId}:${hash}`, Value: timestamp
  private recentNotifications = new Map<string, number>();
  private static DEBOUNCE_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

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


    console.log(`Sending notification for ${userId} via ${enabledAdapters.join(', ')}`, prefs);
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

  async createAndSend(input: CreateNotificationInput): Promise<{
    notification: NotificationRecord;
    sendResult: { success: boolean; results: Record<string, boolean> };
  }> {
    // Debounce: skip if same content was sent to same user within 2 minutes
    if (this.isDuplicateNotification(input.userId, input.body, input.type)) {
      console.log(`Skipping duplicate notification for user ${input.userId}: "${input.body.slice(0, 50)}..."`);
      // Still create the DB record but don't send
      const notification = await notificationRepository.create(input);
      await notificationRepository.updateStatus(notification.id, 'dismissed');
      return { notification, sendResult: { success: false, results: {} } };
    }

    // Mark this content as recently sent
    this.markNotificationSent(input.userId, input.body, input.type);

    // Create notification record
    const notification = await notificationRepository.create(input);

    // Supersede previous notifications for same terminal if applicable
    if (input.terminalId && (input.type === 'user_input_required' || input.type === 'permission_request')) {
      await notificationRepository.supersedePreviousForTerminal(
        input.terminalId,
        input.type,
        notification.id
      );
    }

    // Send via adapters
    const sendResult = await this.notify(input.userId, {
      sessionId: input.sessionId,
      terminalId: input.terminalId,
      type: input.type,
      title: input.title,
      body: input.body,
      actions: input.actions,
      metadata: {
        ...input.metadata,
        notificationId: notification.id, // Include for mobile response handling
      },
      priority: input.priority,
    });

    // Update status to sent if successful
    if (sendResult.success) {
      await notificationRepository.updateStatus(notification.id, 'sent');
    }

    return { notification, sendResult };
  }

  async dismissBySession(sessionId: string): Promise<number> {
    return notificationRepository.dismissBySession(sessionId);
  }

  async dismissByTerminal(terminalId: string): Promise<number> {
    return notificationRepository.dismissByTerminal(terminalId);
  }

  private getContentKey(userId: string, body: string, type: string): string {
    // Simple hash: userId + type + normalized body content
    return `${userId}:${type}:${body.trim().toLowerCase()}`;
  }

  private isDuplicateNotification(userId: string, body: string, type: string): boolean {
    // Clean up expired entries periodically
    const now = Date.now();
    if (this.recentNotifications.size > 100) {
      for (const [key, timestamp] of this.recentNotifications) {
        if (now - timestamp > NotificationService.DEBOUNCE_WINDOW_MS) {
          this.recentNotifications.delete(key);
        }
      }
    }

    const key = this.getContentKey(userId, body, type);
    const lastSent = this.recentNotifications.get(key);
    if (lastSent && now - lastSent < NotificationService.DEBOUNCE_WINDOW_MS) {
      return true;
    }
    return false;
  }

  private markNotificationSent(userId: string, body: string, type: string): void {
    const key = this.getContentKey(userId, body, type);
    this.recentNotifications.set(key, Date.now());
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
