# Sidebar Session Services

Show running services (Claude, Shell, Docker, Code Server, processes) as sub-items beneath each session in the sidebar. Services auto-appear when active and auto-disappear when stopped.

## Data Model

New `SessionService` type added to the sidebar response:

```typescript
interface SessionService {
  type: 'claude' | 'shell' | 'docker' | 'codeServer' | 'process';
  id: string;          // terminalId for claude/shell/process, 'docker' for docker, 'codeServer' for code server
  label: string;       // e.g. "Claude", "Shell", "Docker (3)", "Code Server", "dev server"
  status: 'running' | 'idle' | 'exited';
  count?: number;      // only for docker — number of running containers
  url?: string;        // only for codeServer — the URL to open
}
```

`SidebarSession` gains one new field:

```typescript
services: SessionService[];
```

## Backend Changes

All changes in the existing `GET /api/sessions/sidebar` endpoint in `sessions.routes.ts`. No new endpoints, no DB changes.

### Terminal-based services (per session)

The sidebar endpoint already calls `terminalService.getSessionTerminals(session.id)` for each session. Extend this to group running terminals by type:

- `claude` terminals: Each becomes a service with `label: 'Claude'`
- `shell` terminals: Each becomes a service with `label: t.name || 'Shell'`
- `process` terminals: Each becomes a service with `label: t.name || 'Process'`

Only terminals with `status === 'running'` are included.

### Docker (fetched once, attached globally)

Before the session loop, call `dockerService.listContainers()` once. Count containers with `state === 'running'`. If count > 0, add a single Docker service entry to each active session:

```typescript
{ type: 'docker', id: 'docker', label: `Docker (${count})`, status: 'running', count }
```

Docker is system-wide, not per-session, so the same count appears on all active sessions.

### Code Server (fetched once, attached globally)

Before the session loop, call `codeServerManager.getStatus()`. If `'running'`, add a Code Server service entry to each active session:

```typescript
{ type: 'codeServer', id: 'codeServer', label: 'Code Server', status: 'running', url: CODE_SERVER_URL }
```

### Error handling

Docker and code server checks use `.catch(() => [])` / fallback so they never break the sidebar response.

## Frontend Changes

### 1. Type update (`packages/ui/src/lib/api.ts`)

Add `SessionService` interface and add `services` field to `SidebarSession`.

### 2. ServiceRow component (`packages/ui/src/components/AppSidebar.tsx`)

New inline component rendered below each `SessionRow`:

- Indented further than session rows (`pl-7` or similar)
- Small text (`text-[10px]`)
- Color-coded status dot per type:
  - `claude` = blue
  - `shell` = green
  - `process` = purple
  - `docker` = cyan
  - `codeServer` = green
- Click behavior:
  - Claude/Shell/Process: Navigate to `/sessions/:sessionId/:terminalId`
  - Code Server: `window.open(url, '_blank')`
  - Docker: Navigate to `/sessions/:sessionId` (session page)

### 3. Render in session list

Inside `ProjectGroup` and unassigned sessions, after each `SessionRow`, conditionally render services:

```tsx
{session.services?.length > 0 && (
  <div className="space-y-px">
    {session.services.map(service => (
      <ServiceRow key={service.id} sessionId={session.id} service={service} />
    ))}
  </div>
)}
```

Services only render when the array is non-empty.

## Polling & Lifecycle

No new polling mechanism. The sidebar already polls `/api/sessions/sidebar` via React Query on an interval. Services data rides along with each response.

- Service starts (terminal created, docker up, code server launched) -> next poll picks it up -> row appears
- Service stops (terminal exits, containers stop, code server idle-stopped) -> next poll omits it -> row disappears
- No frontend cleanup logic needed — UI reflects current backend state

## Visual Layout

```
Project Name
  session (feature-branch)           +5 -2
    Claude                           [blue dot]
    Shell                            [green dot]
    dev server                       [purple dot]
    Docker (3)                       [cyan dot]
    Code Server                      [green dot]
```

## Files to Modify

1. `packages/api/src/routes/sessions.routes.ts` — enrich sidebar endpoint with services
2. `packages/ui/src/lib/api.ts` — add `SessionService` type, update `SidebarSession`
3. `packages/ui/src/components/AppSidebar.tsx` — add `ServiceRow` component, render under sessions
