import { eq, and, inArray, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, notifications } from '../../db';
import type { CreateNotificationInput, NotificationRecord, NotificationAction } from './types';

export class NotificationRepository {
  async create(input: CreateNotificationInput): Promise<NotificationRecord> {
    const id = nanoid();
    const now = new Date();

    await db.insert(notifications).values({
      id,
      userId: input.userId,
      sessionId: input.sessionId,
      terminalId: input.terminalId,
      type: input.type,
      title: input.title,
      body: input.body,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      actions: input.actions ? JSON.stringify(input.actions) : null,
      priority: input.priority || 'normal',
      status: 'pending',
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    return this.findById(id) as Promise<NotificationRecord>;
  }

  async findById(id: string): Promise<NotificationRecord | null> {
    const result = await db.query.notifications.findFirst({
      where: eq(notifications.id, id),
    });

    return result ? this.mapToRecord(result) : null;
  }

  async findByUser(
    userId: string,
    options?: {
      status?: ('pending' | 'sent' | 'read' | 'resolved' | 'dismissed')[];
      sessionId?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<NotificationRecord[]> {
    const conditions = [eq(notifications.userId, userId)];

    if (options?.status && options.status.length > 0) {
      conditions.push(inArray(notifications.status, options.status));
    }

    if (options?.sessionId) {
      conditions.push(eq(notifications.sessionId, options.sessionId));
    }

    const results = await db.query.notifications.findMany({
      where: and(...conditions),
      orderBy: [desc(notifications.createdAt)],
      limit: options?.limit || 50,
      offset: options?.offset || 0,
    });

    return results.map(r => this.mapToRecord(r));
  }

  async getUnreadCount(userId: string): Promise<number> {
    const results = await db.query.notifications.findMany({
      where: and(
        eq(notifications.userId, userId),
        inArray(notifications.status, ['pending', 'sent'])
      ),
      columns: { id: true },
    });

    return results.length;
  }

  async updateStatus(
    id: string,
    status: 'pending' | 'sent' | 'read' | 'resolved' | 'dismissed',
    resolvedAction?: string
  ): Promise<void> {
    const updates: Record<string, unknown> = {
      status,
      updatedAt: new Date(),
    };

    if (status === 'resolved' && resolvedAction) {
      updates.resolvedAction = resolvedAction;
      updates.resolvedAt = new Date();
    }

    await db.update(notifications)
      .set(updates)
      .where(eq(notifications.id, id));
  }

  async markManyAsRead(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    await db.update(notifications)
      .set({ status: 'read', updatedAt: new Date() })
      .where(inArray(notifications.id, ids));
  }

  async dismissBySession(sessionId: string): Promise<number> {
    const result = await db.update(notifications)
      .set({ status: 'dismissed', updatedAt: new Date() })
      .where(and(
        eq(notifications.sessionId, sessionId),
        inArray(notifications.status, ['pending', 'sent'])
      ))
      .returning({ id: notifications.id });

    return result.length;
  }

  async dismissByTerminal(terminalId: string): Promise<number> {
    const result = await db.update(notifications)
      .set({ status: 'dismissed', updatedAt: new Date() })
      .where(and(
        eq(notifications.terminalId, terminalId),
        inArray(notifications.status, ['pending', 'sent'])
      ))
      .returning({ id: notifications.id });

    return result.length;
  }

  async supersedePreviousForTerminal(
    terminalId: string,
    type: string,
    excludeId: string
  ): Promise<number> {
    const result = await db.update(notifications)
      .set({ status: 'dismissed', updatedAt: new Date() })
      .where(and(
        eq(notifications.terminalId, terminalId),
        eq(notifications.type, type as any),
        inArray(notifications.status, ['pending', 'sent']),
        // Exclude the new notification
      ))
      .returning({ id: notifications.id });

    // Filter out the excluded ID manually since Drizzle doesn't have neq easily
    return result.filter(r => r.id !== excludeId).length;
  }

  private mapToRecord(row: typeof notifications.$inferSelect): NotificationRecord {
    return {
      id: row.id,
      userId: row.userId,
      sessionId: row.sessionId,
      terminalId: row.terminalId,
      type: row.type,
      title: row.title,
      body: row.body,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      actions: row.actions ? JSON.parse(row.actions) : null,
      priority: row.priority || 'normal',
      status: row.status || 'pending',
      resolvedAction: row.resolvedAction,
      resolvedAt: row.resolvedAt,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

export const notificationRepository = new NotificationRepository();
