# Docker Support - Design Document

**Status:** Ready for implementation

**Goal:** Enable running dev containers (Redis, PostgreSQL, etc.) from within the Remote Agent platform, with a dedicated Docker tab in the session UI and file manager integration.

---

## Decisions

### Docker Runtime: Socket Mount

Mount the host's Docker socket into the Remote Agent container.

**Rationale:** Industry standard (VS Code Dev Containers, Gitpod). Avoids `--privileged` mode and DinD complexity.

| Approach | Verdict | Reason |
|----------|---------|--------|
| Docker Socket Mount | **Selected** | Simple, performant, shared image cache |
| True DinD (`--privileged`) | Rejected | Privileged mode, storage driver conflicts |
| Sysbox Runtime | Rejected | Requires host-level install, less portable |

### Container Scope: Global

Containers are shared across all sessions, not per-project. This is a closed/single-user system, so isolation is unnecessary overhead.

### Docker Tab Features

- **Container manager** — list all containers, start/stop/restart, view logs
- **Service definitions** — define services via UI form, one-click start/stop
- **Dockerfile detection** — auto-detect Dockerfiles in project directories
- **Docker Compose detection** — auto-detect `docker-compose.yml` / `compose.yml` files
- **File Manager integration** — contextual "Run" action on Dockerfiles and compose files

---

## Architecture

### Infrastructure Changes

**`docker/Dockerfile`** — Install Docker CLI (not daemon):
```dockerfile
# Install Docker CLI only (socket mount provides the daemon)
RUN install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && apt-get install -y docker-ce-cli docker-compose-plugin && \
    rm -rf /var/lib/apt/lists/*
```

**All docker-compose files** — Add socket mount:
```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

**`docker/entrypoint.sh`** — Fix socket permissions at runtime:
```bash
# Match container's docker group GID to host's socket GID
if [ -S /var/run/docker.sock ]; then
  SOCK_GID=$(stat -c '%g' /var/run/docker.sock)
  groupmod -g "$SOCK_GID" docker 2>/dev/null || groupadd -g "$SOCK_GID" docker
  usermod -aG docker agent
fi
```

---

### Backend

#### DockerService (`packages/api/src/services/docker/docker.service.ts`)

Wraps Docker CLI commands via Bun's `spawn()`. No Docker SDK dependency — keeps it lightweight and uses the same process management patterns as TerminalService.

```
DockerService
  ├── listContainers()          → docker ps -a --format json
  ├── startContainer(id)        → docker start <id>
  ├── stopContainer(id)         → docker stop <id>
  ├── restartContainer(id)      → docker restart <id>
  ├── removeContainer(id)       → docker rm <id>
  ├── getContainerLogs(id)      → docker logs --tail 200 -f <id>  (streamed)
  ├── buildImage(dockerfile)    → docker build -f <path> .
  ├── runContainer(image, opts) → docker run -d <image>
  ├── composeUp(composePath)    → docker compose -f <path> up -d
  ├── composeDown(composePath)  → docker compose -f <path> down
  ├── composePs(composePath)    → docker compose -f <path> ps --format json
  └── detectFiles(projectPath)  → scan for Dockerfile*, docker-compose*, compose.yml
```

#### Docker Routes (`packages/api/src/routes/docker.routes.ts`)

```
GET    /docker/containers                    → list all containers
POST   /docker/containers/:id/start          → start container
POST   /docker/containers/:id/stop           → stop container
POST   /docker/containers/:id/restart        → restart container
DELETE /docker/containers/:id                → remove container
GET    /docker/containers/:id/logs           → stream logs (WebSocket or SSE)
POST   /docker/build                         → build from Dockerfile path
POST   /docker/run                           → run container from image
POST   /docker/compose/up                    → docker compose up
POST   /docker/compose/down                  → docker compose down
GET    /docker/compose/ps                    → docker compose ps
GET    /docker/detect/:projectPath           → detect Dockerfiles and compose files
```

#### Log Streaming

Container logs streamed via a process terminal. When user clicks "Logs" on a container, backend spawns `docker logs -f <id>` as a process terminal. This reuses the existing PTY/WebSocket infrastructure — no new streaming mechanism needed.

---

### Frontend

#### DockerPanel (`packages/ui/src/components/DockerPanel.tsx`)

Follows the RunConfigPanel pattern: header + scrollable list + action modals.

**Sections:**

1. **Running Containers** — Live list (polled every 5s like RunConfigPanel)
   - Each row: container name, image, status, ports, age
   - Actions: stop, restart, remove, view logs (opens terminal tab)
   - Status dots: green=running, yellow=paused, gray=exited

2. **Detected Files** — Auto-scanned on panel open
   - Groups: Dockerfiles, Compose files
   - Each item: file path relative to project root
   - Actions: Build (Dockerfile), Up/Down (compose file)

3. **Quick Run** — Form to run a container from an image
   - Fields: image name, container name (optional), ports, env vars, volumes
   - "Run" button

#### Session.tsx Changes

- Add `'docker'` to `ViewMode` type
- Add Docker button in toolbar (Container icon from Lucide)
- Add render branch for `viewMode === 'docker'`

```tsx
// Toolbar button
<Button
  variant={viewMode === 'docker' ? 'secondary' : 'ghost'}
  size="icon"
  onClick={() => setViewMode(viewMode === 'docker' ? 'terminal' : 'docker')}
  title="Docker"
>
  <Container className="h-4 w-4" />
</Button>

// Content
viewMode === 'docker' ? (
  <DockerPanel sessionId={id} projectId={session?.project?.id} />
) : ...
```

#### File Manager Integration

In `FileContextMenu.tsx`, add contextual Docker actions based on filename pattern matching:

```
Filename matches           → Action shown
Dockerfile*                → "Build Image"
docker-compose*.yml/yaml   → "Compose Up" / "Compose Down"
compose*.yml/yaml          → "Compose Up" / "Compose Down"
```

When triggered, calls the corresponding Docker API endpoint directly. On success, switches to Docker panel to show the result.

---

### Data Flow

```
FileExplorer                DockerPanel                 Session toolbar
  │ (context menu)            │ (direct actions)          │ (toggle)
  └──→ POST /docker/build     └──→ POST /docker/...       └──→ viewMode='docker'
       POST /compose/up            GET /docker/containers
                                   GET /docker/detect/...
                                        │
                                   DockerService
                                        │
                                   docker CLI → host Docker daemon
                                        │        (via socket mount)
                                   spawn() process terminals for logs
```

---

### No New Database Tables

Docker state lives in the Docker daemon itself — no need to duplicate it in PostgreSQL. The `docker ps` / `docker compose ps` commands are the source of truth. This keeps the implementation simple and avoids state sync issues.

The only persistence is the Docker socket and Docker's own storage on the host.

---

### File Detection Patterns

```typescript
const DOCKER_PATTERNS = {
  dockerfile: /^Dockerfile(\..+)?$/i,
  compose: /^(docker-)?compose(\..+)?\.(yml|yaml)$/i,
};
```

Scanned recursively in project directory (max depth 3 to avoid noise).
