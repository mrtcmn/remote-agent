# Smart Notifications & Terminal Title Tracking - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Suppress push notifications when user is active in the browser, suppress snackbar toasts for the terminal the user is currently viewing, and parse PTY title escape sequences to show dynamic terminal names.

**Architecture:** Three independent features: (1) Backend user presence tracking via heartbeat endpoint + frontend heartbeat hook, checked before sending push notifications. (2) Frontend-only check in NotificationListener to skip toasts for the active terminal. (3) Backend OSC title parsing in terminal output stream, broadcast via WebSocket to update frontend terminal names.

**Tech Stack:** Elysia (backend), React hooks (frontend), xterm.js, Firebase Cloud Messaging, WebSocket

---

### Task 1: User Presence Manager (Backend)

**Files:**
- Create: `packages/api/src/services/presence/index.ts`

**Step 1: Create the presence service**

Create `packages/api/src/services/presence/index.ts`:

```typescript
// In-memory user presence tracking
interface UserPresence {
  lastHeartbeat: number;
  activeTerminalIds: Set<string>;
}

class PresenceManager {
  private presence = new Map<string, UserPresence>();
  private static ACTIVE_THRESHOLD_MS = 60 * 1000; // 1 minute

  heartbeat(userId: string, terminalId?: string): void {
    const existing = this.presence.get(userId);
    const activeTerminalIds = new Set<string>();
    if (terminalId) activeTerminalIds.add(terminalId);

    this.presence.set(userId, {
      lastHeartbeat: Date.now(),
      activeTerminalIds,
    });
  }

  isUserActive(userId: string): boolean {
    const p = this.presence.get(userId);
    if (!p) return false;
    return Date.now() - p.lastHeartbeat < PresenceManager.ACTIVE_THRESHOLD_MS;
  }

  isTerminalActive(userId: string, terminalId: string): boolean {
    const p = this.presence.get(userId);
    if (!p) return false;
    if (Date.now() - p.lastHeartbeat >= PresenceManager.ACTIVE_THRESHOLD_MS) return false;
    return p.activeTerminalIds.has(terminalId);
  }
}

export const presenceManager = new PresenceManager();
```

**Step 2: Commit**

```bash
git add packages/api/src/services/presence/index.ts
git commit -m "feat: add user presence manager for activity tracking"
```

---

### Task 2: Heartbeat API Endpoint (Backend)

**Files:**
- Create: `packages/api/src/routes/presence.routes.ts`
- Modify: `packages/api/src/routes/index.ts`

**Step 1: Create heartbeat route**

Create `packages/api/src/routes/presence.routes.ts`:

```typescript
import { Elysia, t } from 'elysia';
import { requireAuth } from '../auth/middleware';
import { presenceManager } from '../services/presence';

export const presenceRoutes = new Elysia({ prefix: '/presence' })
  .use(requireAuth)

  .post('/heartbeat', async ({ user, body }) => {
    presenceManager.heartbeat(user!.id, body.terminalId);
    return { ok: true };
  }, {
    body: t.Object({
      terminalId: t.Optional(t.String()),
    }),
  });
```

**Step 2: Register in routes/index.ts**

In `packages/api/src/routes/index.ts`, add import and `.use(presenceRoutes)`:

```typescript
import { presenceRoutes } from './presence.routes';
// ... existing imports

export const api = new Elysia({ prefix: '/api' })
  .use(authRoutes)
  .use(sessionRoutes)
  // ... existing routes
  .use(presenceRoutes)
  .use(versionRoutes);
```

**Step 3: Commit**

```bash
git add packages/api/src/routes/presence.routes.ts packages/api/src/routes/index.ts
git commit -m "feat: add heartbeat endpoint for user presence tracking"
```

---

### Task 3: Suppress Push Notifications for Active Users (Backend)

**Files:**
- Modify: `packages/api/src/services/notification/notification.service.ts`

**Step 1: Integrate presence check into createAndSend**

In `packages/api/src/services/notification/notification.service.ts`, add import at top:

```typescript
import { presenceManager } from '../presence';
```

In the `createAndSend` method, after the debounce check block (after `this.markNotificationSent(...)` on line ~122) and before calling `this.notify(...)` on line ~137, add the presence check:

```typescript
    // Skip push notification if user is actively using the app
    if (presenceManager.isUserActive(input.userId)) {
      console.log(`Skipping push notification for active user ${input.userId}`);
      await notificationRepository.updateStatus(notification.id, 'sent');
      return { notification, sendResult: { success: true, results: { skipped_active_user: true } } };
    }
```

This goes right after the "Supersede previous notifications" block (line ~134) and before the `// Send via adapters` comment.

**Step 2: Commit**

```bash
git add packages/api/src/services/notification/notification.service.ts
git commit -m "feat: skip push notifications when user is active in browser"
```

---

### Task 4: Frontend Activity Heartbeat Hook

**Files:**
- Create: `packages/ui/src/hooks/useActivityHeartbeat.ts`
- Modify: `packages/ui/src/lib/api.ts`
- Modify: `packages/ui/src/App.tsx`

**Step 1: Add heartbeat API method**

In `packages/ui/src/lib/api.ts`, add to the `api` object (near the notification methods):

```typescript
  sendHeartbeat: (terminalId?: string) =>
    request('/presence/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ terminalId }),
    }),
```

**Step 2: Create the useActivityHeartbeat hook**

Create `packages/ui/src/hooks/useActivityHeartbeat.ts`:

```typescript
import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
const IDLE_TIMEOUT_MS = 60_000; // 1 minute

/**
 * Sends heartbeat to backend when user is active (visible tab + recent interaction).
 * Extracts the currently viewed terminalId from the URL.
 */
export function useActivityHeartbeat() {
  const lastActivityRef = useRef(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const onActivity = () => {
      lastActivityRef.current = Date.now();
    };

    // Track user interactions
    window.addEventListener('mousemove', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity, { passive: true });
    window.addEventListener('touchstart', onActivity, { passive: true });
    window.addEventListener('scroll', onActivity, { passive: true });
    window.addEventListener('click', onActivity, { passive: true });

    const sendHeartbeat = () => {
      // Only send if tab is visible and user recently interacted
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastActivityRef.current > IDLE_TIMEOUT_MS) return;

      // Extract terminalId from URL: /sessions/:id/:terminalId
      const match = window.location.pathname.match(/\/sessions\/[^/]+\/([^/]+)/);
      const terminalId = match?.[1] || undefined;

      api.sendHeartbeat(terminalId).catch(() => {
        // Silently ignore heartbeat failures
      });
    };

    // Send immediately on mount, then every 30s
    sendHeartbeat();
    intervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    return () => {
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('touchstart', onActivity);
      window.removeEventListener('scroll', onActivity);
      window.removeEventListener('click', onActivity);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);
}
```

**Step 3: Mount in App.tsx**

In `packages/ui/src/App.tsx`, add inside the `ProtectedRoute` children, right next to `<NotificationListener />`:

Add import:
```typescript
import { ActivityHeartbeat } from './components/ActivityHeartbeat';
```

Create a tiny wrapper component. Actually, since hooks can't be called outside components, create a simple wrapper. The simplest approach: add `useActivityHeartbeat()` call inside `NotificationListener` component, since it's already mounted at the right level.

**Revised approach** - Add to `NotificationListener.tsx` instead of App.tsx:

In `NotificationListener.tsx`, add at the top of the component function body:

```typescript
import { useActivityHeartbeat } from '@/hooks/useActivityHeartbeat';

export function NotificationListener() {
  const queryClient = useQueryClient();
  const [isReady, setIsReady] = useState(false);

  // Track user activity and send heartbeats
  useActivityHeartbeat();

  // ... rest of component unchanged
```

**Step 4: Commit**

```bash
git add packages/ui/src/hooks/useActivityHeartbeat.ts packages/ui/src/lib/api.ts packages/ui/src/components/NotificationListener.tsx
git commit -m "feat: add activity heartbeat hook to track user presence"
```

---

### Task 5: Suppress Snackbar for Active Terminal (Frontend)

**Files:**
- Modify: `packages/ui/src/components/NotificationListener.tsx`

**Step 1: Add active-terminal check before showing toast**

In `NotificationListener.tsx`, in the foreground message handler (inside `onForegroundMessage` callback), replace the toast block:

Current code (lines 79-84):
```typescript
      // Show toast
      if (notification.notification) {
        toast({
          title: notification.notification.title || 'Notification',
          description: notification.notification.body,
        });
      }
```

Replace with:
```typescript
      // Show toast (skip if user is viewing the notification's terminal)
      if (notification.notification) {
        const notifTerminalId = notification.data?.terminalId;
        const urlMatch = window.location.pathname.match(/\/sessions\/[^/]+\/([^/]+)/);
        const activeTerminalId = urlMatch?.[1];

        const isViewingTerminal = notifTerminalId && activeTerminalId && notifTerminalId === activeTerminalId;

        if (!isViewingTerminal) {
          toast({
            title: notification.notification.title || 'Notification',
            description: notification.notification.body,
          });
        }
      }
```

**Step 2: Commit**

```bash
git add packages/ui/src/components/NotificationListener.tsx
git commit -m "feat: suppress toast notifications for the terminal user is viewing"
```

---

### Task 6: PTY Title Parsing (Backend)

**Files:**
- Modify: `packages/api/src/services/terminal/types.ts`
- Modify: `packages/api/src/services/terminal/terminal.service.ts`

**Step 1: Add titleBuffer to TerminalInstance type**

In `packages/api/src/services/terminal/types.ts`, add field to `TerminalInstance`:

```typescript
export interface TerminalInstance {
  id: string;
  sessionId: string;
  name: string;
  type: TerminalType;
  command: string[];
  cols: number;
  rows: number;
  persist: boolean;
  status: TerminalStatus;
  exitCode: number | null;
  process: Subprocess | null;
  terminal: BunTerminal | null;
  scrollback: string[];
  rawScrollback?: Uint8Array[];
  titleBuffer?: string; // Buffer for partial OSC title sequences
  createdAt: Date;
}
```

**Step 2: Add title parsing to handleOutput in terminal.service.ts**

Add a new private method `parseTitle` to `TerminalService`:

```typescript
  /**
   * Parse OSC title escape sequences from terminal output.
   * Handles: \x1b]0;title\x07, \x1b]2;title\x07, \x1b]0;title\x1b\\
   * Buffers partial sequences across chunks.
   */
  private parseTitle(terminalId: string, data: Uint8Array): void {
    const instance = this.instances.get(terminalId);
    if (!instance) return;

    const text = new TextDecoder().decode(data);
    const combined = (instance.titleBuffer || '') + text;

    // Match OSC title sequences: ESC ] 0; title BEL  or  ESC ] 0; title ESC \
    const oscRegex = /\x1b\](?:0|2);([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;
    let match: RegExpExecArray | null;
    let lastTitle: string | null = null;

    while ((match = oscRegex.exec(combined)) !== null) {
      lastTitle = match[1];
    }

    // Check if there's an incomplete OSC sequence at the end
    const partialMatch = combined.match(/\x1b\](?:0|2);[^\x07\x1b]*$/);
    instance.titleBuffer = partialMatch ? partialMatch[0] : undefined;

    // Update name if we found a new title
    if (lastTitle !== null && lastTitle !== instance.name) {
      instance.name = lastTitle;
      // Update DB
      db.update(terminals)
        .set({ name: lastTitle })
        .where(eq(terminals.id, terminalId))
        .catch(err => console.error('[TerminalService] Failed to update terminal name:', err));

      this.emit('title_changed', terminalId, lastTitle);
    }
  }
```

Add import for `db` and `terminals` at the top (already imported in the file).

**Step 3: Call parseTitle from handleOutput**

In the existing `handleOutput` method, add call at the end (before `this.emit('output', output)`):

```typescript
    // Parse OSC title sequences
    this.parseTitle(terminalId, data);

    const output: TerminalOutput = {
      // ... existing code
```

**Step 4: Commit**

```bash
git add packages/api/src/services/terminal/types.ts packages/api/src/services/terminal/terminal.service.ts
git commit -m "feat: parse PTY title escape sequences and update terminal names"
```

---

### Task 7: Broadcast Title Changes via WebSocket (Backend)

**Files:**
- Modify: `packages/api/src/routes/terminal-websocket.ts`

**Step 1: Add title_changed event listener**

In `terminal-websocket.ts`, after the existing `terminalService.on('resized', ...)` block (around line 43), add:

```typescript
terminalService.on('title_changed', (terminalId: string, name: string) => {
  const connections = terminalConnections.get(terminalId);
  if (connections) {
    const message = JSON.stringify({
      type: 'title_changed',
      data: { name },
    });
    connections.forEach(ws => ws.send(message));
  }
});
```

**Step 2: Commit**

```bash
git add packages/api/src/routes/terminal-websocket.ts
git commit -m "feat: broadcast terminal title changes via WebSocket"
```

---

### Task 8: Handle Title Changes in Frontend

**Files:**
- Modify: `packages/ui/src/hooks/useTerminal.ts`
- Modify: `packages/ui/src/pages/Session.tsx`

**Step 1: Add onTitleChanged callback to useTerminal**

In `packages/ui/src/hooks/useTerminal.ts`, add `onTitleChanged` to the options interface and handle the `title_changed` WebSocket message.

Find the options/props type for `useTerminal` and add:
```typescript
onTitleChanged?: (name: string) => void;
```

In the WebSocket message handler (the `switch` or `if` block that handles different message types), add a case:
```typescript
case 'title_changed':
  opts.onTitleChanged?.(parsed.data.name);
  break;
```

**Step 2: Use onTitleChanged in Session.tsx**

In `packages/ui/src/pages/Session.tsx`, the `<Terminal>` component needs to pass `onTitleChanged`.

First, check how `Terminal` component passes props to `useTerminal`. The Terminal component at `packages/ui/src/components/Terminal.tsx` likely accepts props and forwards them.

Add `onTitleChanged` prop to the `<Terminal>` component usage:

```tsx
<Terminal
  key={activeTerminal.id}
  terminalId={activeTerminal.id}
  className="h-full"
  onExit={() => {
    queryClient.invalidateQueries({ queryKey: ['terminals', id] });
  }}
  onTitleChanged={() => {
    queryClient.invalidateQueries({ queryKey: ['terminals', id] });
  }}
/>
```

This will refetch the terminal list from the backend, picking up the updated name.

**Step 3: Pass onTitleChanged through Terminal component**

In `packages/ui/src/components/Terminal.tsx`, add `onTitleChanged` to the component's props interface and pass it to `useTerminal`.

**Step 4: Commit**

```bash
git add packages/ui/src/hooks/useTerminal.ts packages/ui/src/components/Terminal.tsx packages/ui/src/pages/Session.tsx
git commit -m "feat: display dynamic terminal titles from PTY in UI"
```

---

### Task 9: Verify and Test

**Step 1: Build the project to check for type errors**

Run: `cd /app/workspaces/qRler1aMqKwOsAPH2IEdKf9SWyg6YSVX/remote-agent && bun run build` (or the appropriate build command)

Expected: Clean build with no errors.

**Step 2: Manual verification checklist**
- Start a Claude terminal - verify it picks up the title Claude sets
- Open a session page - verify heartbeat requests appear in network tab (~30s interval)
- When viewing a terminal, trigger a notification for that terminal - verify no toast appears
- Switch to a different terminal - verify notifications for the original terminal now show toasts
- Minimize browser tab - verify push notifications resume after 1 minute

**Step 3: Commit any fixes**

```bash
git commit -am "fix: address issues found during testing"
```
