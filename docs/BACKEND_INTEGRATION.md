# Backend Integration Plan — Design System UI Update

## Overview

The UI has been updated to use design-system components. Most features are already wired to existing API endpoints. This document covers the remaining backend work needed.

---

## 1. System Metrics API (Status Bar)

**Priority:** High
**Current state:** CPU, memory, and disk values in the status bar are **simulated with random numbers** (`useSystemMetrics` in `Session.tsx`).

### Endpoint needed

```
GET /api/system/metrics
```

### Response

```json
{
  "cpu": 34,
  "ram": 6.2,
  "ramTotal": 16,
  "disk": 67
}
```

| Field | Type | Description |
|-------|------|-------------|
| `cpu` | `number` | CPU usage percentage (0–100) |
| `ram` | `number` | RAM usage in GB |
| `ramTotal` | `number` | Total RAM in GB |
| `disk` | `number` | Disk usage percentage (0–100) |

### Implementation notes

- Use `os` module: `os.cpus()`, `os.totalmem()`, `os.freemem()`
- For disk: `child_process.execSync('df -k / | tail -1')` or `statvfs`
- Poll interval on frontend: **1200ms** (already set in `useSystemMetrics`)
- Consider caching on backend (refresh every 1s) to avoid per-request overhead

### Frontend integration

Replace the simulated hook in `packages/ui/src/pages/Session.tsx`:

```ts
// Replace useSystemMetrics() with:
function useSystemMetrics() {
  const { data } = useQuery({
    queryKey: ['system-metrics'],
    queryFn: () => api.getSystemMetrics(),
    refetchInterval: 1200,
  });
  return {
    cpu: data?.cpu ?? 0,
    ram: data?.ram ?? 0,
    ramTotal: data?.ramTotal ?? 16,
    disk: data?.disk ?? 0,
  };
}
```

Add to `api.ts`:

```ts
getSystemMetrics: () => request<{ cpu: number; ram: number; ramTotal: number; disk: number }>('/system/metrics'),
```

---

## 2. Already Integrated (No Backend Changes Needed)

These features are fully wired to existing endpoints:

| Feature | Endpoint(s) | Status |
|---------|-------------|--------|
| Sidebar sessions/projects | `GET /api/sessions/sidebar` | ✅ Working |
| Session terminals (tabs) | `GET /api/terminals/session/:id` | ✅ Working |
| Create terminal (Claude/Shell) | `POST /api/terminals` | ✅ Working |
| Close terminal | `DELETE /api/terminals/:id` | ✅ Working |
| Git status & branch | `GET /api/sessions/:id/git/status` | ✅ Working |
| Notifications (list, unread, mark read) | `GET/POST /api/notifications/*` | ✅ Working |
| Docker panel | `GET/POST /api/docker/*` | ✅ Working |
| Preview | `POST /api/preview/start` | ✅ Working |
| Editor (VS Code) | `POST /api/editor/open` | ✅ Working |
| Run configs | `GET/POST /api/run-configs/*` | ✅ Working |
| Env editor | `GET/PUT /api/projects/:id/env` | ✅ Working |
| File explorer | `GET /api/sessions/:id/files` | ✅ Working |

---

## 3. Optional Future Enhancements

These are **not blocking** but would improve the UI:

### 3a. Notification Tabs (Mentions, Inbox, Archive)

The notification panel has 4 tabs but only "General" is wired. To enable the others:

- **Mentions**: Filter notifications where the user is @mentioned (requires `mentions` field in notification metadata)
- **Inbox**: Show only `input_required` type notifications
- **Archive**: Show `dismissed` / `resolved` notifications (`GET /api/notifications?status=dismissed,resolved`)

### 3b. Session Connection Status

The status bar shows a hardcoded "Connected" status. To make it real:

- Use the existing WebSocket connection state from `useWebSocket` hook
- Map connection states: connected → green, reconnecting → yellow, disconnected → red

### 3c. Notification Choices/Actions

The design-system notification component supports inline choice buttons (approve/reject/remind). To enable:

- Add `choices` field to `NotificationRecord` type
- Backend sets choices on `input_required` notifications
- Frontend resolves choice via `PATCH /api/notifications/:id` with `{ resolvedAction: "approve" }`

---

## Summary

| Item | Effort | Priority |
|------|--------|----------|
| System metrics endpoint | ~30 min | High |
| WebSocket connection status | ~15 min | Low |
| Notification tab filtering | ~1 hour | Low |
| Notification inline choices | ~2 hours | Low |
