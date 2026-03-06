# Code-Server Integration Design

## Overview

Add on-demand VS Code editor instances (via code-server) to sessions. Each session can spawn one code-server instance, displayed as a new "Editor" view mode tab in the Session page via iframe.

## Architecture

```
Session Page (UI)
  └─ viewMode === 'editor'
       └─ <iframe src="/api/editor-proxy/{instanceId}/..." />

Elysia API
  ├─ POST /api/sessions/:id/editor     → spawn code-server
  ├─ DELETE /api/sessions/:id/editor   → kill code-server
  ├─ GET /api/sessions/:id/editor      → get status
  └─ ALL /api/editor-proxy/:id/*       → reverse proxy to localhost:PORT

CodeEditorService (new service)
  ├─ spawnEditor(sessionId, projectPath) → Bun.spawn code-server
  ├─ stopEditor(sessionId) → kill process
  ├─ getEditor(sessionId) → instance info
  └─ on exit → update DB, emit event
```

## Components

### 1. Database — `codeEditors` table

| Column | Type | Notes |
|--------|------|-------|
| id | text (nanoid) | PK |
| sessionId | text | FK to claudeSessions, unique |
| port | integer | Allocated port |
| pid | integer | OS process ID |
| status | text | 'running' or 'stopped' |
| createdAt | timestamp | |
| stoppedAt | timestamp | nullable |

### 2. CodeEditorService

Mirrors the terminal service pattern:
- In-memory `Map<string, EditorInstance>` for active instances
- Spawn command: `code-server --auth none --bind-addr 127.0.0.1:{port} --idle-timeout-seconds 600 {projectPath}`
- Port allocation: dynamic from range 13000-13100, scan for free port
- Handles process exit → DB update + cleanup
- Startup orphan reconciliation (mark stale 'running' records as 'stopped')

### 3. Reverse Proxy

New Elysia route:
- `ALL /api/editor-proxy/:id/*` proxies HTTP requests to `localhost:{port}`
- Must support WebSocket upgrade (code-server requires WS)
- Uses existing auth middleware
- Looks up port from in-memory map or DB

### 4. UI Changes — Session.tsx

- New "Editor" button in view mode toolbar (code icon)
- New `'editor'` viewMode rendering an iframe
- Start/stop controls
- Status indicator: starting → running → stopped
- Restart button when stopped

## Process Lifecycle

```
User clicks "Editor" tab
  → UI calls POST /api/sessions/:id/editor
  → API finds free port, spawns code-server process
  → DB record created with status 'running'
  → API returns { id, port, status }
  → UI renders iframe: /api/editor-proxy/{id}/

code-server idle 10 min
  → self-terminates via --idle-timeout-seconds
  → API catches exit event, updates DB status to 'stopped'
  → UI shows "Editor stopped" with restart button

Session deleted
  → cascade kills editor process if running
  → DB record cleaned up
```

## Constraints

- One editor per session (enforced by unique sessionId)
- code-server binary must be pre-installed on host
- Bound to localhost only (127.0.0.1), not externally reachable
- Auth handled by API proxy layer, code-server auth disabled
- No memory/cgroup limits — rely on idle timeout for resource management
- No extension pre-installation
- Port range: 13000-13100 (max ~100 concurrent instances)

## Not In Scope

- Multi-instance per session
- Custom code-server settings/extensions management
- Memory limits via cgroups
- Auto-install of code-server binary
