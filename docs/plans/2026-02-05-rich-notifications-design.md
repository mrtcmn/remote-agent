# Rich Notifications System Design

## Overview

Enrich notification content across Web, Android, and iOS platforms with actionable buttons, inline replies, persistent storage, and session lifecycle management.

## Goals

1. **Actionable notifications** — Users can respond directly from notifications (Approve/Deny, Reply)
2. **Better context** — Show relevant details per notification type
3. **Persistence** — Store notifications in DB for inbox UI, badge sync, and audit
4. **Session lifecycle** — Auto-dismiss notifications when sessions/terminals end

## Platform Capabilities

| Feature | Android | iOS | Web |
|---|---|---|---|
| Action buttons | 3 max | 4 max | 2 max |
| Direct reply (text input) | Yes | Yes | No |
| Notification grouping | group key | threadId | tag (replaces) |
| Custom sounds | Yes | Yes | No |
| Badge count | Yes | Yes | Limited |
| Notification channels | Yes | No | No |
| Priority levels | 5 | 4 (iOS 15+) | requireInteraction |

## Notification Categories & Actions

### permission_request
- **Priority:** HIGH (Android heads-up, iOS timeSensitive, Web requireInteraction)
- **Actions:** Approve, Deny
- **Channel (Android):** `permissions`
- **Sound:** Urgent chime

### user_input_required
- **Priority:** HIGH
- **Actions:** Open, Reply (with text input on mobile)
- **Channel (Android):** `input_required`
- **Sound:** Gentle ping

### task_complete
- **Priority:** LOW (Android), passive (iOS), default (Web)
- **Actions:** View Result
- **Channel (Android):** `task_complete`
- **Sound:** Success tone

### error
- **Priority:** DEFAULT
- **Actions:** View Error
- **Channel (Android):** `errors`
- **Sound:** Alert sound

## Data Model

### notifications table

```sql
CREATE TYPE notification_type AS ENUM (
  'user_input_required',
  'permission_request',
  'task_complete',
  'error',
  'session_started',
  'session_ended'
);

CREATE TYPE notification_status AS ENUM (
  'pending',    -- Created, not yet sent
  'sent',       -- Sent via FCM
  'read',       -- User opened/viewed
  'resolved',   -- User took action
  'dismissed'   -- Auto-dismissed (session ended, superseded)
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  terminal_id TEXT,

  type notification_type NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  actions JSONB DEFAULT '[]',
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),

  status notification_status DEFAULT 'pending',
  resolved_action TEXT,
  resolved_at TIMESTAMP,
  expires_at TIMESTAMP,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_status ON notifications(user_id, status);
CREATE INDEX idx_notifications_session ON notifications(session_id);
CREATE INDEX idx_notifications_terminal ON notifications(terminal_id) WHERE terminal_id IS NOT NULL;
```

### Lifecycle Rules

1. **Session terminates** → All `pending`/`sent` notifications for that session → `dismissed`
2. **User responds** (via app or inline reply) → Notification → `resolved` with `resolved_action`
3. **New notification supersedes** → New `user_input_required` for same terminal → Previous one → `dismissed`
4. **Terminal closes** → Its notifications → `dismissed`

## API Endpoints

### Notification Inbox

```
GET /api/notifications
  Query: status?, sessionId?, limit?, cursor?
  Response: { notifications: Notification[], cursor?: string }

GET /api/notifications/unread-count
  Response: { count: number }

PATCH /api/notifications/:id
  Body: { status: 'read' | 'resolved', resolvedAction?: string }
  Response: { success: true }

POST /api/notifications/mark-read
  Body: { ids: string[] }
  Response: { success: true }

POST /api/notifications/dismiss
  Body: { sessionId?: string, terminalId?: string }
  Response: { success: true }
```

### Action Response (Mobile Inline Reply)

```
POST /api/notifications/:id/respond
  Body: { action: string, text?: string }
  Response: { success: true }

  Side effects:
    1. Mark notification as resolved
    2. Write response to terminal (permission_request or user_input_required)
```

### Modified Internal Hooks

```
POST /internal/hooks/attention
  Before: Send FCM only
  After:
    1. Create notification record (status: pending)
    2. Send FCM with notificationId in data
    3. Update status to 'sent'
    4. Supersede previous notification for same terminal

POST /internal/hooks/complete
  Same pattern: persist then send
```

## FCM Payload Structure

### Android

```typescript
{
  data: {
    notificationId: string,
    sessionId: string,
    terminalId?: string,
    type: NotificationType,
    metadata: string, // JSON
  },
  notification: {
    title: string,
    body: string,
  },
  android: {
    channelId: 'input_required' | 'permissions' | 'task_complete' | 'errors',
    priority: 'high' | 'normal',
    notification: {
      color: '#FFFFFF',
      icon: 'notification_icon',
    }
  }
}
```

### iOS (APNs via FCM)

```typescript
{
  apns: {
    payload: {
      aps: {
        alert: { title, body },
        badge: unreadCount,
        sound: 'input_ping.wav',
        category: 'permission_request' | 'user_input_required' | 'task_complete' | 'error',
        'thread-id': sessionId,
        'mutable-content': 1,
        'interruption-level': 'time-sensitive' | 'active' | 'passive',
      }
    }
  }
}
```

### Web

```typescript
{
  webpush: {
    notification: {
      title,
      body,
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      tag: sessionId, // Replaces previous with same tag
      requireInteraction: type === 'permission_request' || type === 'user_input_required',
      actions: [
        { action: 'approve', title: 'Approve' },
        { action: 'deny', title: 'Deny' },
      ]
    },
    fcmOptions: {
      link: `/sessions/${sessionId}`,
    }
  }
}
```

## Mobile App Integration (Expo)

### Notification Categories

```typescript
// Register on app start
await Notifications.setNotificationCategoryAsync('permission_request', [
  {
    identifier: 'approve',
    buttonTitle: 'Approve',
    options: { opensAppToForeground: false }
  },
  {
    identifier: 'deny',
    buttonTitle: 'Deny',
    options: { opensAppToForeground: false }
  },
]);

await Notifications.setNotificationCategoryAsync('user_input_required', [
  {
    identifier: 'open',
    buttonTitle: 'Open',
    options: { opensAppToForeground: true }
  },
  {
    identifier: 'reply',
    buttonTitle: 'Reply',
    textInput: {
      submitButtonTitle: 'Send',
      placeholder: 'Type response...'
    }
  },
]);

await Notifications.setNotificationCategoryAsync('task_complete', [
  {
    identifier: 'view',
    buttonTitle: 'View',
    options: { opensAppToForeground: true }
  },
]);

await Notifications.setNotificationCategoryAsync('error', [
  {
    identifier: 'view',
    buttonTitle: 'View Error',
    options: { opensAppToForeground: true }
  },
]);
```

### Android Notification Channels

```typescript
if (Platform.OS === 'android') {
  await Notifications.setNotificationChannelAsync('input_required', {
    name: 'Input Required',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'input_ping.wav',
    vibrationPattern: [0, 250, 250, 250],
  });

  await Notifications.setNotificationChannelAsync('permissions', {
    name: 'Permission Requests',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'urgent_chime.wav',
    vibrationPattern: [0, 250, 250, 250],
  });

  await Notifications.setNotificationChannelAsync('task_complete', {
    name: 'Task Complete',
    importance: Notifications.AndroidImportance.LOW,
    sound: 'success.wav',
  });

  await Notifications.setNotificationChannelAsync('errors', {
    name: 'Errors',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'alert.wav',
  });
}
```

### Background Task for Responses

```typescript
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';

const NOTIFICATION_RESPONSE_TASK = 'notification-response-task';

TaskManager.defineTask<Notifications.NotificationTaskPayload>(
  NOTIFICATION_RESPONSE_TASK,
  async ({ data, error }) => {
    if (error) {
      console.error('Notification task error:', error);
      return;
    }

    if ('actionIdentifier' in data) {
      const response = data as Notifications.NotificationResponse;
      const { actionIdentifier, userText } = response;
      const { notificationId } = response.notification.request.content.data;

      if (actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
        // User tapped notification body — handled by navigation
        return;
      }

      try {
        await api.post(`/notifications/${notificationId}/respond`, {
          action: actionIdentifier,
          text: userText,
        });
      } catch (err) {
        console.error('Failed to send notification response:', err);
      }
    }
  }
);

// Register on app start
Notifications.registerTaskAsync(NOTIFICATION_RESPONSE_TASK);
```

### Navigation on Tap

```typescript
// In root layout
function useNotificationObserver() {
  useEffect(() => {
    function redirect(notification: Notifications.Notification) {
      const { sessionId } = notification.request.content.data;
      if (sessionId) {
        router.push(`/sessions/${sessionId}`);
      }
    }

    // Handle cold start
    const response = Notifications.getLastNotificationResponse();
    if (response?.notification) {
      redirect(response.notification);
    }

    // Handle runtime taps
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        if (response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
          redirect(response.notification);
        }
      }
    );

    return () => subscription.remove();
  }, []);
}
```

## Web Service Worker Updates

Update `firebase-messaging-sw.js` to handle action clicks:

```javascript
self.addEventListener('notificationclick', (event) => {
  const { action, notification } = event;
  const { sessionId, notificationId } = notification.data;

  notification.close();

  if (action && action !== 'default') {
    // Send action response to backend
    event.waitUntil(
      fetch(`/api/notifications/${notificationId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action }),
      })
    );
  }

  // Open or focus app
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/sessions/') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(`/sessions/${sessionId}`);
    })
  );
});
```

## Real-time Sync

Polling approach for MVP:

```typescript
// Poll unread count every 30s when app is foregrounded
const { data: unreadCount } = useQuery({
  queryKey: ['notifications', 'unread-count'],
  queryFn: () => api.get('/notifications/unread-count'),
  refetchInterval: 30000,
  refetchIntervalInBackground: false,
});
```

Future: Upgrade to SSE or WebSocket for instant updates.

## Implementation Order

### Phase 1: Database & Core API
1. Add `notifications` table with Drizzle schema
2. Create migration
3. Implement CRUD routes for notifications
4. Modify internal hooks to persist before sending

### Phase 2: Notification Lifecycle
1. Add session termination hook → dismiss notifications
2. Add supersede logic for same-terminal notifications
3. Implement `/respond` endpoint with terminal write-through

### Phase 3: Enhanced FCM Payloads
1. Update Firebase adapter for platform-specific fields
2. Add `notificationId` to all payloads
3. Implement notification grouping (tag/threadId/group)
4. Add priority/interruption level mapping

### Phase 4: Web Enhancements
1. Update service worker for action handling
2. Add notification inbox UI (bell icon + dropdown)
3. Implement badge count display
4. Add polling for real-time sync

### Phase 5: Mobile App (Expo)
1. Set up notification categories with actions
2. Configure Android notification channels
3. Implement background task for responses
4. Add navigation handling on notification tap
5. Build notification inbox screen

### Phase 6: Polish
1. Add custom sounds (requires config plugin rebuild)
2. Implement quiet hours enforcement with persisted notifications
3. Add notification preferences UI (per-type toggles)
4. Analytics/metrics for notification delivery & engagement

## Files to Modify/Create

### Backend (packages/api)
- `src/db/schema.ts` — Add notifications table
- `src/db/migrations/` — New migration
- `src/routes/notifications.routes.ts` — Extend with inbox endpoints
- `src/services/notification/notification.service.ts` — Add persistence
- `src/services/notification/adapters/firebase.adapter.ts` — Enhanced payloads
- `src/routes/internal.routes.ts` — Modify hooks to persist

### Frontend Web (packages/ui)
- `public/firebase-messaging-sw.js` — Action handling
- `src/components/NotificationInbox.tsx` — New component
- `src/hooks/useNotifications.ts` — Add inbox queries

### Mobile App (separate Expo project)
- `app.json` — Config plugin for sounds
- `src/lib/notifications.ts` — Categories, channels, tasks
- `app/_layout.tsx` — Navigation observer
- `src/screens/NotificationsScreen.tsx` — Inbox UI

## Out of Scope (Future)

- MessagingStyle (requires notifee)
- Progress notifications (requires backend progress events)
- SSE/WebSocket real-time sync
- Email/Telegram/Webhook notification adapters
- Rich media attachments (images in notifications)
