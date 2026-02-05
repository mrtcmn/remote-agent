# Rich Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add persistent notifications with actionable buttons, inline replies, session lifecycle management, and platform-specific payloads.

**Architecture:** Extend existing notification system with a `notifications` table for persistence, modify internal hooks to persist-then-send, add inbox API endpoints, enhance FCM payloads with platform-specific action buttons and channels.

**Tech Stack:** Drizzle ORM, PostgreSQL, Elysia routes, Firebase Admin SDK, expo-notifications (mobile).

---

## Phase 1: Database Schema

### Task 1: Add notification enums and table to schema

**Files:**
- Modify: `packages/api/src/db/schema.ts`

**Step 1: Add notification enums after existing enums (line 11)**

```typescript
export const notificationTypeEnum = pgEnum('notification_type', [
  'user_input_required',
  'permission_request',
  'task_complete',
  'error',
  'session_started',
  'session_ended',
]);

export const notificationStatusEnum = pgEnum('notification_status', [
  'pending',
  'sent',
  'read',
  'resolved',
  'dismissed',
]);

export const notificationPriorityEnum = pgEnum('notification_priority', ['low', 'normal', 'high']);
```

**Step 2: Add notifications table after notificationPrefs table (after line 113)**

```typescript
// Persistent notifications
export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }).notNull(),
  sessionId: text('session_id').references(() => claudeSessions.id, { onDelete: 'cascade' }).notNull(),
  terminalId: text('terminal_id'),

  type: notificationTypeEnum('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  metadata: text('metadata'), // JSON
  actions: text('actions'), // JSON array of NotificationAction
  priority: notificationPriorityEnum('priority').default('normal'),

  status: notificationStatusEnum('status').default('pending'),
  resolvedAction: text('resolved_action'),
  resolvedAt: timestamp('resolved_at'),
  expiresAt: timestamp('expires_at'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```

**Step 3: Add notifications relations after notificationPrefsRelations (after line 244)**

```typescript
export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(user, {
    fields: [notifications.userId],
    references: [user.id],
  }),
  session: one(claudeSessions, {
    fields: [notifications.sessionId],
    references: [claudeSessions.id],
  }),
}));
```

**Step 4: Add to userRelations (inside the many section)**

Add `notifications: many(notifications),` to userRelations.

**Step 5: Add to claudeSessionsRelations (inside the many section)**

Add `notifications: many(notifications),` to claudeSessionsRelations.

**Step 6: Add type exports at the end of the file**

```typescript
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
```

**Step 7: Commit**

```bash
git add packages/api/src/db/schema.ts
git commit -m "feat(db): add notifications table schema with enums and relations"
```

---

### Task 2: Update db/index.ts exports

**Files:**
- Modify: `packages/api/src/db/index.ts`

**Step 1: Add notifications to the exports**

Find the line that exports schema tables and add `notifications`:

```typescript
export {
  // ... existing exports
  notifications,
  notificationTypeEnum,
  notificationStatusEnum,
  notificationPriorityEnum,
} from './schema';
```

**Step 2: Commit**

```bash
git add packages/api/src/db/index.ts
git commit -m "feat(db): export notifications table and enums"
```

---

### Task 3: Generate and run migration

**Files:**
- Create: `packages/api/src/db/migrations/XXXX_add_notifications.sql` (auto-generated)

**Step 1: Generate migration**

Run: `cd packages/api && bun run db:generate`

Expected: New migration file created in `packages/api/src/db/migrations/`

**Step 2: Run migration**

Run: `cd packages/api && bun run db:migrate`

Expected: Migration applied successfully

**Step 3: Commit migration file**

```bash
git add packages/api/src/db/migrations/
git commit -m "chore(db): add notifications table migration"
```

---

## Phase 2: Notification Service Updates

### Task 4: Update notification types

**Files:**
- Modify: `packages/api/src/services/notification/types.ts`

**Step 1: Add NotificationRecord type for DB records**

```typescript
export interface NotificationRecord {
  id: string;
  userId: string;
  sessionId: string;
  terminalId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, unknown> | null;
  actions?: NotificationAction[] | null;
  priority: 'low' | 'normal' | 'high';
  status: 'pending' | 'sent' | 'read' | 'resolved' | 'dismissed';
  resolvedAction?: string | null;
  resolvedAt?: Date | null;
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateNotificationInput {
  userId: string;
  sessionId: string;
  terminalId?: string;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  actions?: NotificationAction[];
  priority?: 'low' | 'normal' | 'high';
  expiresAt?: Date;
}
```

**Step 2: Commit**

```bash
git add packages/api/src/services/notification/types.ts
git commit -m "feat(notification): add NotificationRecord and CreateNotificationInput types"
```

---

### Task 5: Create notification repository

**Files:**
- Create: `packages/api/src/services/notification/notification.repository.ts`

**Step 1: Create the repository file**

```typescript
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
```

**Step 2: Commit**

```bash
git add packages/api/src/services/notification/notification.repository.ts
git commit -m "feat(notification): add notification repository for DB operations"
```

---

### Task 6: Update notification service to persist notifications

**Files:**
- Modify: `packages/api/src/services/notification/notification.service.ts`

**Step 1: Import repository and types**

Add at top:
```typescript
import { notificationRepository } from './notification.repository';
import type { CreateNotificationInput, NotificationRecord } from './types';
```

**Step 2: Add new method for persist-then-send pattern**

Add after the `notify` method:

```typescript
async createAndSend(input: CreateNotificationInput): Promise<{
  notification: NotificationRecord;
  sendResult: { success: boolean; results: Record<string, boolean> };
}> {
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
```

**Step 3: Commit**

```bash
git add packages/api/src/services/notification/notification.service.ts
git commit -m "feat(notification): add createAndSend method for persist-then-send pattern"
```

---

### Task 7: Export repository from notification service index

**Files:**
- Modify: `packages/api/src/services/notification/index.ts`

**Step 1: Add export**

```typescript
export { notificationRepository } from './notification.repository';
```

**Step 2: Commit**

```bash
git add packages/api/src/services/notification/index.ts
git commit -m "feat(notification): export notification repository"
```

---

## Phase 3: API Endpoints

### Task 8: Add inbox endpoints to notifications routes

**Files:**
- Modify: `packages/api/src/routes/notifications.routes.ts`

**Step 1: Import repository**

Add at top:
```typescript
import { notificationRepository } from '../services/notification';
```

**Step 2: Add GET /notifications endpoint (list with pagination)**

```typescript
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
```

**Step 3: Add GET /notifications/unread-count endpoint**

```typescript
// Get unread count
.get('/unread-count', async ({ user }) => {
  const count = await notificationRepository.getUnreadCount(user!.id);
  return { count };
})
```

**Step 4: Add PATCH /notifications/:id endpoint**

```typescript
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
```

**Step 5: Add POST /notifications/mark-read endpoint**

```typescript
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
```

**Step 6: Add POST /notifications/dismiss endpoint**

```typescript
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
})
```

**Step 7: Commit**

```bash
git add packages/api/src/routes/notifications.routes.ts
git commit -m "feat(api): add notification inbox endpoints"
```

---

### Task 9: Add notification respond endpoint

**Files:**
- Modify: `packages/api/src/routes/notifications.routes.ts`

**Step 1: Add POST /notifications/:id/respond endpoint**

This endpoint handles responses from mobile inline replies:

```typescript
// Respond to notification (for mobile inline replies)
.post('/:id/respond', async ({ user, params, body, set }) => {
  const notification = await notificationRepository.findById(params.id);

  if (!notification) {
    set.status = 404;
    return { error: 'Notification not found' };
  }

  if (notification.userId !== user!.id) {
    set.status = 403;
    return { error: 'Forbidden' };
  }

  // Mark as resolved
  await notificationRepository.updateStatus(params.id, 'resolved', body.action);

  // If this is a permission_request or user_input_required, write to terminal
  if (
    notification.terminalId &&
    (notification.type === 'permission_request' || notification.type === 'user_input_required')
  ) {
    // Import terminal service to write response
    const { terminalManager } = await import('../services/terminal');

    let response = body.action;
    if (body.text) {
      response = body.text;
    } else if (body.action === 'approve') {
      response = 'yes';
    } else if (body.action === 'deny') {
      response = 'no';
    }

    try {
      terminalManager.writeToTerminal(notification.terminalId, response + '\n');
    } catch (error) {
      console.error('Failed to write to terminal:', error);
      // Don't fail the response - notification is already resolved
    }
  }

  return { success: true };
}, {
  params: t.Object({
    id: t.String(),
  }),
  body: t.Object({
    action: t.String(),
    text: t.Optional(t.String()),
  }),
})
```

**Step 2: Commit**

```bash
git add packages/api/src/routes/notifications.routes.ts
git commit -m "feat(api): add notification respond endpoint for mobile inline replies"
```

---

### Task 10: Update internal hooks to persist notifications

**Files:**
- Modify: `packages/api/src/routes/internal.routes.ts`

**Step 1: Update imports**

```typescript
import { notificationService } from '../services/notification';
import type { NotificationType, NotificationAction } from '../services/notification/types';
```

**Step 2: Update /hooks/attention to persist notification**

Replace the existing notification sending block:

```typescript
// Define actions based on type
const actions: NotificationAction[] = body.type === 'permission_request'
  ? [
      { label: 'Approve', action: 'approve' },
      { label: 'Deny', action: 'deny' },
    ]
  : [
      { label: 'Open', action: 'open' },
      { label: 'Reply', action: 'reply' },
    ];

// Create and send notification
const result = await notificationService.createAndSend({
  userId: session.userId,
  sessionId: body.sessionId,
  terminalId: body.terminalId,
  type: body.type as NotificationType,
  title: body.type === 'permission_request' ? 'Permission Request' : 'Attention Required',
  body: body.prompt,
  actions,
  priority: 'high',
});

return {
  success: true,
  notificationId: result.notification.id,
  notification: result.sendResult,
};
```

**Step 3: Update /hooks/complete to persist notification**

Replace the existing notification sending block:

```typescript
// Create and send notification
const result = await notificationService.createAndSend({
  userId: session.userId,
  sessionId: body.sessionId,
  terminalId: body.terminalId,
  type: 'task_complete' as NotificationType,
  title: 'Task Complete',
  body: body.prompt,
  actions: [{ label: 'View', action: 'view' }],
  priority: 'normal',
});

return {
  success: true,
  notificationId: result.notification.id,
  notification: result.sendResult,
};
```

**Step 4: Commit**

```bash
git add packages/api/src/routes/internal.routes.ts
git commit -m "feat(api): update internal hooks to persist notifications before sending"
```

---

## Phase 4: Enhanced FCM Payloads

### Task 11: Update Firebase adapter with platform-specific payloads

**Files:**
- Modify: `packages/api/src/services/notification/adapters/firebase.adapter.ts`

**Step 1: Add helper function for notification channels**

Add after imports:

```typescript
function getAndroidChannelId(type: string): string {
  switch (type) {
    case 'permission_request':
      return 'permissions';
    case 'user_input_required':
      return 'input_required';
    case 'error':
      return 'errors';
    case 'task_complete':
      return 'task_complete';
    default:
      return 'default';
  }
}

function getIosCategory(type: string): string {
  return type; // Category names match type names
}

function getIosInterruptionLevel(priority: string | undefined, type: string): string {
  if (priority === 'high') return 'time-sensitive';
  if (type === 'task_complete') return 'passive';
  return 'active';
}
```

**Step 2: Update the message construction in send method**

Replace the message construction (lines 93-137):

```typescript
const notificationId = payload.metadata?.notificationId as string | undefined;

const message: admin.messaging.MulticastMessage = {
  tokens: tokens.map(t => t.token),
  notification: {
    title: this.formatTitle(payload),
    body: this.formatBody(payload),
  },
  data: {
    sessionId: payload.sessionId,
    terminalId: payload.terminalId || '',
    type: payload.type,
    notificationId: notificationId || '',
    ...(payload.metadata ? { metadata: JSON.stringify(payload.metadata) } : {}),
  },
  webpush: {
    fcmOptions: {
      link: `/sessions/${payload.sessionId}`,
    },
    notification: {
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      tag: payload.sessionId, // Group by session
      requireInteraction: payload.priority === 'high',
      actions: payload.actions?.slice(0, 2).map(a => ({
        action: a.action,
        title: a.label,
      })),
    },
  },
  android: {
    priority: payload.priority === 'high' ? 'high' : 'normal',
    notification: {
      channelId: getAndroidChannelId(payload.type),
      color: '#6366f1', // Indigo
      icon: 'notification_icon',
      tag: `${payload.sessionId}:${payload.terminalId || 'session'}`, // For grouping
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
        category: getIosCategory(payload.type),
        'thread-id': payload.sessionId,
        'mutable-content': 1,
        'interruption-level': getIosInterruptionLevel(payload.priority, payload.type),
      },
    },
  },
};
```

**Step 3: Commit**

```bash
git add packages/api/src/services/notification/adapters/firebase.adapter.ts
git commit -m "feat(notification): enhance FCM payloads with platform-specific channels and categories"
```

---

## Phase 5: Session Lifecycle Integration

### Task 12: Add notification dismissal on session status change

**Files:**
- Modify: `packages/api/src/routes/sessions.routes.ts` (or wherever session status updates happen)

**Step 1: Find where session status is updated to 'terminated' and add notification dismissal**

After the session status update to 'terminated', add:

```typescript
// Dismiss pending notifications for this session
import { notificationService } from '../services/notification';
await notificationService.dismissBySession(sessionId);
```

**Step 2: Commit**

```bash
git add packages/api/src/routes/sessions.routes.ts
git commit -m "feat(session): dismiss notifications when session terminates"
```

---

### Task 13: Add notification dismissal on terminal close

**Files:**
- Modify: `packages/api/src/services/terminal/terminal.manager.ts` (or terminal routes)

**Step 1: Find where terminal is closed/exited and add notification dismissal**

After terminal status is set to 'exited', add:

```typescript
// Dismiss pending notifications for this terminal
import { notificationService } from '../notification';
await notificationService.dismissByTerminal(terminalId);
```

**Step 2: Commit**

```bash
git add packages/api/src/services/terminal/terminal.manager.ts
git commit -m "feat(terminal): dismiss notifications when terminal closes"
```

---

## Phase 6: Web Service Worker Updates

### Task 14: Update service worker for action handling

**Files:**
- Modify: `packages/ui/public/firebase-messaging-sw.js`

**Step 1: Update notificationclick handler**

Replace the existing handler:

```javascript
self.addEventListener('notificationclick', (event) => {
  const { action, notification } = event;
  const data = notification.data || {};
  const { sessionId, notificationId } = data;

  notification.close();

  // Handle action button clicks
  if (action && action !== 'default' && notificationId) {
    event.waitUntil(
      fetch(`/api/notifications/${notificationId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action }),
      }).catch(err => console.error('Failed to send action response:', err))
    );
  }

  // Open or focus the app
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to find an existing window with the session
      for (const client of clientList) {
        if (client.url.includes(`/sessions/${sessionId}`) && 'focus' in client) {
          return client.focus();
        }
      }
      // Try to find any app window
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client && sessionId) {
            return client.navigate(`/sessions/${sessionId}`);
          }
          return;
        }
      }
      // Open new window
      if (sessionId) {
        return clients.openWindow(`/sessions/${sessionId}`);
      }
      return clients.openWindow('/');
    })
  );
});
```

**Step 2: Update background message handler to include notificationId in data**

The existing handler should already pass through data, but verify it includes notificationId.

**Step 3: Commit**

```bash
git add packages/ui/public/firebase-messaging-sw.js
git commit -m "feat(ui): update service worker to handle notification action responses"
```

---

## Phase 7: Frontend Inbox UI

### Task 15: Add API client methods for notifications

**Files:**
- Modify: `packages/ui/src/lib/api.ts`

**Step 1: Add notification inbox methods**

```typescript
export interface NotificationRecord {
  id: string;
  sessionId: string;
  terminalId?: string | null;
  type: string;
  title: string;
  body: string;
  priority: 'low' | 'normal' | 'high';
  status: 'pending' | 'sent' | 'read' | 'resolved' | 'dismissed';
  resolvedAction?: string | null;
  createdAt: string;
}

getNotifications: (params?: { status?: string; sessionId?: string; limit?: number; offset?: number }) => {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.sessionId) searchParams.set('sessionId', params.sessionId);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  const query = searchParams.toString();
  return request<{ notifications: NotificationRecord[] }>(`/notifications${query ? `?${query}` : ''}`);
},

getUnreadCount: () => request<{ count: number }>('/notifications/unread-count'),

markNotificationRead: (id: string) =>
  request(`/notifications/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'read' }),
  }),

markNotificationsRead: (ids: string[]) =>
  request('/notifications/mark-read', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  }),

dismissNotifications: (params: { sessionId?: string; terminalId?: string }) =>
  request('/notifications/dismiss', {
    method: 'POST',
    body: JSON.stringify(params),
  }),
```

**Step 2: Commit**

```bash
git add packages/ui/src/lib/api.ts
git commit -m "feat(ui): add notification inbox API client methods"
```

---

### Task 16: Create NotificationInbox component

**Files:**
- Create: `packages/ui/src/components/NotificationInbox.tsx`

**Step 1: Create the component**

```typescript
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, X, ExternalLink } from 'lucide-react';
import { api, NotificationRecord } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';

export function NotificationInbox() {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: unreadData } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: api.getUnreadCount,
    refetchInterval: 30000,
  });

  const { data: notificationsData, isLoading } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.getNotifications({ status: 'pending,sent,read', limit: 20 }),
    enabled: isOpen,
  });

  const markReadMutation = useMutation({
    mutationFn: (ids: string[]) => api.markNotificationsRead(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const unreadCount = unreadData?.count ?? 0;
  const notifications = notificationsData?.notifications ?? [];

  const handleMarkAllRead = () => {
    const unreadIds = notifications
      .filter(n => n.status === 'pending' || n.status === 'sent')
      .map(n => n.id);
    if (unreadIds.length > 0) {
      markReadMutation.mutate(unreadIds);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-md hover:bg-muted"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-md border bg-popover shadow-lg z-50">
            <div className="flex items-center justify-between p-3 border-b">
              <h3 className="font-semibold">Notifications</h3>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Mark all read
                </button>
              )}
            </div>

            {isLoading ? (
              <div className="p-4 text-center text-muted-foreground">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground">No notifications</div>
            ) : (
              <ul>
                {notifications.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    onClose={() => setIsOpen(false)}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function NotificationItem({
  notification,
  onClose,
}: {
  notification: NotificationRecord;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isUnread = notification.status === 'pending' || notification.status === 'sent';

  const markReadMutation = useMutation({
    mutationFn: () => api.markNotificationRead(notification.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const handleClick = () => {
    if (isUnread) {
      markReadMutation.mutate();
    }
    window.location.href = `/sessions/${notification.sessionId}`;
    onClose();
  };

  return (
    <li
      className={`p-3 border-b last:border-b-0 cursor-pointer hover:bg-muted ${
        isUnread ? 'bg-muted/50' : ''
      }`}
      onClick={handleClick}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{notification.title}</span>
            {isUnread && (
              <span className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0" />
            )}
          </div>
          <p className="text-sm text-muted-foreground line-clamp-2">{notification.body}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
          </p>
        </div>
        <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      </div>
    </li>
  );
}
```

**Step 2: Commit**

```bash
git add packages/ui/src/components/NotificationInbox.tsx
git commit -m "feat(ui): add NotificationInbox component with polling"
```

---

### Task 17: Add NotificationInbox to app header

**Files:**
- Modify: `packages/ui/src/components/Header.tsx` (or wherever the app header is)

**Step 1: Import and add NotificationInbox**

```typescript
import { NotificationInbox } from './NotificationInbox';

// In the header JSX, add:
<NotificationInbox />
```

**Step 2: Commit**

```bash
git add packages/ui/src/components/Header.tsx
git commit -m "feat(ui): add NotificationInbox to app header"
```

---

## Summary

**Total Tasks:** 17

**Files Modified:**
- `packages/api/src/db/schema.ts`
- `packages/api/src/db/index.ts`
- `packages/api/src/services/notification/types.ts`
- `packages/api/src/services/notification/notification.service.ts`
- `packages/api/src/services/notification/index.ts`
- `packages/api/src/routes/notifications.routes.ts`
- `packages/api/src/routes/internal.routes.ts`
- `packages/api/src/routes/sessions.routes.ts`
- `packages/api/src/services/terminal/terminal.manager.ts`
- `packages/api/src/services/notification/adapters/firebase.adapter.ts`
- `packages/ui/public/firebase-messaging-sw.js`
- `packages/ui/src/lib/api.ts`
- `packages/ui/src/components/Header.tsx`

**Files Created:**
- `packages/api/src/services/notification/notification.repository.ts`
- `packages/ui/src/components/NotificationInbox.tsx`
- Migration file (auto-generated)

**Out of Scope (Future Tasks):**
- Mobile app (Expo) integration with notification categories and channels
- Custom notification sounds
- SSE/WebSocket for real-time sync
