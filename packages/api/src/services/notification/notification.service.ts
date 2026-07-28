import { eq } from 'drizzle-orm';
import { db, notificationPrefs } from '../../db';
import type { NotificationAdapter, NotificationPayload, CreateNotificationInput, NotificationRecord } from './types';
import { FirebaseAdapter, WebhookAdapter } from './adapters';
import { notificationRepository } from './notification.repository';
import { emitCreated } from './events';
import { presenceManager } from '../presence';
import { isRemoteMode } from '../../config/mode';

export class NotificationService {
  private adapters = new Map<string, NotificationAdapter>();
  private initialized = false;
  // Debounce: track recently sent notification content per user to avoid duplicates
  // Key: `${userId}:${hash}`, Value: timestamp
  private recentNotifications = new Map<string, number>();
  private static DEBOUNCE_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

  constructor() {
    // Register default adapters — Firebase only in remote mode
    if (isRemoteMode()) {
      this.registerAdapter(new FirebaseAdapter());
    }
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

    // One live notification per terminal: this new event supersedes the previous
    // status for the same terminal (see supersedePreviousForTerminal).
    if (input.terminalId) {
      await notificationRepository.supersedePreviousForTerminal(
        input.terminalId,
        notification.id
      );
    }

    // In-progress "working" pings only update live clients — never push (they fire
    // often). Same for any notification while the user is actively in the app.
    if (input.type === 'session_started' || presenceManager.isUserActive(input.userId)) {
      await notificationRepository.updateStatus(notification.id, 'sent');
      emitCreated({ ...notification, status: 'sent' });
      return { notification, sendResult: { success: true, results: { skipped_push: true } } };
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

    emitCreated({ ...notification, status: sendResult.success ? 'sent' : notification.status });

    return { notification, sendResult };
  }

  /**
   * Resolve a notification on behalf of a user and, for input/permission
   * prompts, type the response into the owning terminal. Shared by the REST
   * respond route and the notifications websocket.
   */
  async respond(
    userId: string,
    id: string,
    input: { action: string; text?: string; answers?: string[] }
  ): Promise<{ ok: true; terminalWritten: boolean } | { ok: false; error: 'not_found' | 'forbidden' }> {
    const notification = await notificationRepository.findById(id);
    if (!notification) { console.log(`[respond] ${id}: not found`); return { ok: false, error: 'not_found' }; }
    if (notification.userId !== userId) {
      console.log(`[respond] ${id}: forbidden (owner=${notification.userId} caller=${userId})`);
      return { ok: false, error: 'forbidden' };
    }

    await notificationRepository.updateStatus(id, 'resolved', input.action);

    let terminalWritten = false;
    if (
      notification.terminalId &&
      (notification.type === 'permission_request' || notification.type === 'user_input_required')
    ) {
      const { terminalService } = await import('../terminal');

      // Claude runs as an interactive TUI, so answers are keystrokes, not typed text:
      //  - a picked option → navigate the arrow-list (down × index) then Enter
      //  - a freeform reply / yes / no → type the text then Enter
      const options = notification.metadata?.options as { label: string; value: string }[] | undefined;
      const optionIndex = options?.findIndex(o => o.value === input.action) ?? -1;
      // AskUserQuestion can carry N questions (metadata.questions); answers[i] is
      // the picked value for question i, in question order.
      const questions = notification.metadata?.questions as { options: { label: string; value: string }[] }[] | undefined;

      let keys: string;
      if (input.answers && input.answers.length > 0 && questions && questions.length > 0) {
        // ponytail: multi-question replay. Assumes each Enter submits the current
        // question and the TUI re-anchors the next question's arrow-list at the top,
        // so we emit (down × optionIndex)+Enter per question and concatenate in order.
        // If Claude's multi-question TUI instead uses Tab between fields or numeric
        // keys, interleave '\t' or emit `${index + 1}` per question here instead.
        keys = input.answers.map((answer, i) => {
          const idx = questions[i]?.options.findIndex(o => o.value === answer) ?? -1;
          return '\x1b[B'.repeat(Math.max(idx, 0)) + '\r';
        }).join('');
      } else if (input.text) {
        keys = input.text + '\r';
      } else if (input.action === 'approve') {
        keys = 'yes\r';
      } else if (input.action === 'deny') {
        keys = 'no\r';
      } else if (optionIndex >= 0) {
        // Interactive AskUserQuestion → drive its on-screen arrow-list (down × index
        // then Enter). Inferred options (classifier read them out of Claude's freeform
        // text — nothing selectable on screen) → type the chosen label as a normal
        // reply, since Claude is just waiting for typed input. Sending arrow keys to a
        // plain prompt does nothing, which is the "option didn't send" bug.
        // ponytail: assumes a single-select, top-anchored list for the interactive case.
        keys = notification.metadata?.interactive
          ? '\x1b[B'.repeat(optionIndex) + '\r'
          : (options?.[optionIndex]?.label ?? input.action) + '\r';
      } else {
        keys = input.action + '\r';
      }

      try {
        await terminalService.write(notification.terminalId, keys);
        terminalWritten = true;
        console.log(`[respond] ${id}: wrote ${JSON.stringify(keys)} → terminal ${notification.terminalId}`);
      } catch (error) {
        console.error(`[respond] ${id}: write FAILED to terminal ${notification.terminalId} (likely dead/restarted): ${(error as Error).message}`);
        // Don't fail the response — the notification is already resolved
      }
    } else {
      console.log(`[respond] ${id}: no terminal write (terminalId=${notification.terminalId}, type=${notification.type})`);
    }

    return { ok: true, terminalWritten };
  }

  /**
   * Merge a patch into a live notification's metadata and re-push it to connected
   * clients. Used for silent, high-frequency "working" detail updates (current
   * tool / todos / context) — no debounce, no supersede, no new DB row. The notch
   * treats a re-pushed running record as an in-place update, not a fresh alert.
   */
  async patchMetadata(id: string, patch: Record<string, unknown>): Promise<NotificationRecord | null> {
    const existing = await notificationRepository.findById(id);
    if (!existing) return null;
    const merged = { ...(existing.metadata ?? {}), ...patch };
    const updated = await notificationRepository.updateMetadata(id, merged);
    if (updated) emitCreated(updated);
    return updated;
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
