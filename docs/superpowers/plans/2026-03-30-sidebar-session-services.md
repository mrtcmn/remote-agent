# Sidebar Session Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show running services (Claude, Shell, Docker, Code Server, processes) as clickable sub-items beneath each session in the sidebar.

**Architecture:** Extend the existing `/api/sessions/sidebar` endpoint to include a `services` array per session, built from in-memory terminal state plus docker/code-server status checks. Frontend adds a `ServiceRow` component rendered below each `SessionRow`. No new endpoints, no DB changes.

**Tech Stack:** Elysia (backend), React + Framer Motion + Lucide icons (frontend), TanStack Query (polling)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/api/src/routes/sessions.routes.ts` | Modify | Add services array to sidebar endpoint response |
| `packages/ui/src/lib/api.ts` | Modify | Add `SessionService` type, update `SidebarSession` |
| `packages/ui/src/components/AppSidebar.tsx` | Modify | Add `ServiceRow` component, render under sessions |

---

### Task 1: Add services to sidebar API response

**Files:**
- Modify: `packages/api/src/routes/sessions.routes.ts:1-9` (imports)
- Modify: `packages/api/src/routes/sessions.routes.ts:514-660` (sidebar endpoint)

- [ ] **Step 1: Add imports for dockerService and codeServerManager**

At the top of `packages/api/src/routes/sessions.routes.ts`, add two new imports after the existing ones:

```typescript
import { dockerService } from '../services/docker';
import { codeServerManager } from '../services/code-server/code-server.service';
```

- [ ] **Step 2: Fetch docker containers and code server status before the session loop**

In the `/sidebar` endpoint handler, after the `worktreeMap` construction (after line 557) and before the `sessionDataMap` loop (line 560), add:

```typescript
    // Fetch docker and code-server status once (used for all sessions)
    const CODE_SERVER_URL = process.env.VITE_CODE_SERVER_URL || '';
    const [dockerContainers, codeServerStatus] = await Promise.all([
      dockerService.listContainers().catch(() => [] as any[]),
      Promise.resolve(codeServerManager.getStatus()),
    ]);
    const runningContainerCount = dockerContainers.filter((c: any) => c.state === 'running').length;
```

- [ ] **Step 3: Build services array inside the session data loop**

Inside the `for (const session of allSessions)` loop, after the line that computes `hasActiveTerminals` (line 563) and the existing `terminals` variable, add service collection logic. Then include `services` in the `sessionDataMap.set()` call.

Replace the `sessionDataMap.set(session.id, { ... })` block (lines 607-617) with:

```typescript
      // Build services array from running terminals
      const services: Array<{
        type: string;
        id: string;
        label: string;
        status: string;
        count?: number;
        url?: string;
      }> = [];

      const runningTerminals = terminals.filter(t => t.status === 'running');

      for (const term of runningTerminals) {
        if (term.type === 'claude') {
          services.push({ type: 'claude', id: term.id, label: 'Claude', status: 'running' });
        } else if (term.type === 'shell') {
          services.push({ type: 'shell', id: term.id, label: term.name || 'Shell', status: 'running' });
        } else if (term.type === 'process') {
          services.push({ type: 'process', id: term.id, label: term.name || 'Process', status: 'running' });
        }
      }

      // Docker: attach to active sessions only
      if (runningContainerCount > 0 && liveStatus === 'active') {
        services.push({
          type: 'docker',
          id: 'docker',
          label: `Docker (${runningContainerCount})`,
          status: 'running',
          count: runningContainerCount,
        });
      }

      // Code Server: attach to active sessions only
      if (codeServerStatus === 'running' && liveStatus === 'active' && CODE_SERVER_URL) {
        services.push({
          type: 'codeServer',
          id: 'codeServer',
          label: 'Code Server',
          status: 'running',
          url: CODE_SERVER_URL,
        });
      }

      sessionDataMap.set(session.id, {
        id: session.id,
        status: session.status,
        liveStatus,
        branchName,
        diffStats,
        commentCount: commentCounts[session.id] || 0,
        worktreeId: session.worktreeId || null,
        worktreeName: worktree?.name || null,
        sessionType: session.worktreeId ? 'worktree' : 'git',
        services,
      });
```

- [ ] **Step 4: Verify the API builds**

Run:
```bash
cd packages/api && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/sessions.routes.ts
git commit -m "feat: add services array to sidebar API response"
```

---

### Task 2: Add frontend types

**Files:**
- Modify: `packages/ui/src/lib/api.ts:1088-1111` (sidebar types)

- [ ] **Step 1: Add SessionService interface**

In `packages/ui/src/lib/api.ts`, add a new interface just before the `SidebarSession` interface (before line 1088):

```typescript
export interface SessionService {
  type: 'claude' | 'shell' | 'docker' | 'codeServer' | 'process';
  id: string;
  label: string;
  status: 'running' | 'idle' | 'exited';
  count?: number;
  url?: string;
}
```

- [ ] **Step 2: Add services field to SidebarSession**

In the existing `SidebarSession` interface, add the `services` field after `sessionType`:

```typescript
export interface SidebarSession {
  id: string;
  status: string;
  liveStatus: string;
  branchName: string;
  diffStats: { additions: number; deletions: number } | null;
  commentCount: number;
  worktreeId: string | null;
  worktreeName: string | null;
  sessionType: 'git' | 'worktree';
  services: SessionService[];
}
```

- [ ] **Step 3: Verify the UI builds**

Run:
```bash
cd packages/ui && npx tsc --noEmit
```
Expected: No errors (services field is added but not consumed yet).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/lib/api.ts
git commit -m "feat: add SessionService type to frontend"
```

---

### Task 3: Add ServiceRow component and render in sidebar

**Files:**
- Modify: `packages/ui/src/components/AppSidebar.tsx:1-18` (imports)
- Modify: `packages/ui/src/components/AppSidebar.tsx:59-126` (after SessionRow)
- Modify: `packages/ui/src/components/AppSidebar.tsx:224-240` (session rendering in ProjectGroup)
- Modify: `packages/ui/src/components/AppSidebar.tsx:446-463` (unassigned session rendering)

- [ ] **Step 1: Add new icon imports**

In `packages/ui/src/components/AppSidebar.tsx`, update the lucide-react import to add the icons needed for service types:

```typescript
import {
  Layers,
  Plus,
  ChevronDown,
  LayoutGrid,
  ListTodo,
  Settings,
  Sparkles,
  Plug,
  FolderGit2,
  Loader2,
  X,
  GripVertical,
  GitBranch,
  Bot,
  TerminalSquare,
  Container,
  Code,
  Play,
} from 'lucide-react';
```

Also add the `SessionService` import:

```typescript
import type { SidebarData, SidebarProject, SidebarSession, SessionService } from '@/lib/api';
```

- [ ] **Step 2: Add service type color and icon maps**

After the `statusDotClass` record (after line 45), add:

```typescript
// ─── Service config ─────────────────────────────────────────────────────────

const serviceConfig: Record<string, { dot: string; icon: typeof Bot }> = {
  claude: { dot: 'bg-blue-500', icon: Bot },
  shell: { dot: 'bg-emerald-500', icon: TerminalSquare },
  process: { dot: 'bg-purple-500', icon: Play },
  docker: { dot: 'bg-cyan-500', icon: Container },
  codeServer: { dot: 'bg-emerald-500', icon: Code },
};
```

- [ ] **Step 3: Add ServiceRow component**

After the `DiffStat` component (after line 57) and before the `SessionRow` component, add:

```typescript
// ─── ServiceRow ─────────────────────────────────────────────────────────────

function ServiceRow({
  sessionId,
  service,
  onNavigate,
}: {
  sessionId: string;
  service: SessionService;
  onNavigate: (path: string) => void;
}) {
  const config = serviceConfig[service.type] || serviceConfig.shell;
  const Icon = config.icon;

  const handleClick = () => {
    if (service.type === 'codeServer' && service.url) {
      window.open(service.url, '_blank');
    } else if (service.type === 'docker') {
      onNavigate(`/sessions/${sessionId}`);
    } else {
      onNavigate(`/sessions/${sessionId}/${service.id}`);
    }
  };

  return (
    <button
      onClick={handleClick}
      className="w-full flex items-center gap-1.5 pl-7 pr-2 py-0.5 rounded text-left text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/50 transition-colors"
    >
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', config.dot)} />
      <Icon className="size-2.5 shrink-0" />
      <span className="text-[10px] truncate">{service.label}</span>
    </button>
  );
}
```

- [ ] **Step 4: Update SessionRow rendering in ProjectGroup to include services**

In the `ProjectGroup` component, inside the `project.sessions.map()` callback (around lines 225-240), update the content to render services after each `SessionRow`:

Replace:
```tsx
              {project.sessions.map((session) => (
                <motion.div
                  key={session.id}
                  variants={{
                    hidden: { opacity: 0, y: -3 },
                    visible: { opacity: 1, y: 0 },
                  }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                >
                  <SessionRow
                    session={session}
                    isSelected={session.id === activeSessionId}
                    onSelect={() => onSelectSession(session.id)}
                  />
                </motion.div>
              ))}
```

With:
```tsx
              {project.sessions.map((session) => (
                <motion.div
                  key={session.id}
                  variants={{
                    hidden: { opacity: 0, y: -3 },
                    visible: { opacity: 1, y: 0 },
                  }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                >
                  <SessionRow
                    session={session}
                    isSelected={session.id === activeSessionId}
                    onSelect={() => onSelectSession(session.id)}
                  />
                  {session.services?.length > 0 && (
                    <div className="space-y-px">
                      {session.services.map((service) => (
                        <ServiceRow
                          key={service.id}
                          sessionId={session.id}
                          service={service}
                          onNavigate={onNavigate}
                        />
                      ))}
                    </div>
                  )}
                </motion.div>
              ))}
```

Note: `ProjectGroup` needs a new `onNavigate` prop. Add it to the props interface and destructuring:

```typescript
  onNavigate: (path: string) => void;
```

- [ ] **Step 5: Pass onNavigate to ProjectGroup from AppSidebar**

In the `AppSidebar` component, add a `handleNavigate` function:

```typescript
  const handleNavigate = useCallback((path: string) => {
    navigate(path);
    onClose?.();
  }, [navigate, onClose]);
```

Then in the `ProjectGroup` usage, add the prop:

```tsx
                    <ProjectGroup
                      project={project}
                      activeSessionId={activeSessionId}
                      onSelectSession={handleSelectSession}
                      onNavigate={handleNavigate}
                      onAdd={() => handleProjectAdd(project.id)}
                      onDragStart={(e) => handleProjectDragStart(e, project.id)}
                      onDragOver={(e) => handleProjectDragOver(e, project.id)}
                      onDrop={(e) => handleProjectDrop(e, project.id)}
                      isDragOver={dragOverProjectId === project.id}
                    />
```

- [ ] **Step 6: Add services rendering for unassigned sessions**

In the unassigned sessions section (around lines 446-463), update the session rendering to also include services:

Replace:
```tsx
                  <div className="space-y-0.5">
                    {activeUnassigned.map((session) => (
                      <SessionRow
                        key={session.id}
                        session={session}
                        isSelected={session.id === activeSessionId}
                        onSelect={() => handleSelectSession(session.id)}
                      />
                    ))}
                  </div>
```

With:
```tsx
                  <div className="space-y-0.5">
                    {activeUnassigned.map((session) => (
                      <div key={session.id}>
                        <SessionRow
                          session={session}
                          isSelected={session.id === activeSessionId}
                          onSelect={() => handleSelectSession(session.id)}
                        />
                        {session.services?.length > 0 && (
                          <div className="space-y-px">
                            {session.services.map((service) => (
                              <ServiceRow
                                key={service.id}
                                sessionId={session.id}
                                service={service}
                                onNavigate={handleNavigate}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
```

- [ ] **Step 7: Verify the full project builds**

Run:
```bash
cd packages/ui && npx tsc --noEmit
```
Expected: No errors.

Then:
```bash
npm run build
```
Expected: Build succeeds.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/components/AppSidebar.tsx
git commit -m "feat: add ServiceRow component showing running services under sessions"
```
