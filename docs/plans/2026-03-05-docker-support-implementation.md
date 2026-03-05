# Docker Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Docker container management to Remote Agent — socket mount infrastructure, backend Docker CLI service, Docker panel UI, and file manager integration.

**Architecture:** Docker CLI wraps host Docker daemon via socket mount. Backend DockerService spawns `docker` commands via Bun's `spawn()`. Frontend DockerPanel follows the RunConfigPanel pattern with polling. Logs stream via existing process terminal PTY infrastructure. No new database tables — Docker daemon is the source of truth.

**Tech Stack:** Docker CLI, Elysia routes, Bun spawn(), React + React Query, Lucide icons, Radix UI context menus

---

### Task 1: Install Docker CLI in Dockerfile

**Files:**
- Modify: `docker/Dockerfile:12-23`

**Step 1: Add Docker CLI installation to infra stage**

In `docker/Dockerfile`, after the GitHub CLI installation block (line 33) and before the "Create app user" comment (line 36), add:

```dockerfile
# Install Docker CLI + Compose plugin (daemon runs on host via socket mount)
RUN install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc && \
    chmod a+r /etc/apt/keyrings/docker.asc && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && \
    apt-get install -y docker-ce-cli docker-compose-plugin && \
    rm -rf /var/lib/apt/lists/*
```

**Step 2: Commit**

```bash
git add docker/Dockerfile
git commit -m "feat: install Docker CLI and Compose plugin in container image"
```

---

### Task 2: Add Docker Socket Mount to Compose Files

**Files:**
- Modify: `docker/docker-compose.yml:32-37`
- Modify: `docker/docker-compose.dev.yml:32-48`
- Modify: `docker/docker-compose.prod.yml:34-38`

**Step 1: Add socket mount to docker-compose.yml**

In `docker/docker-compose.yml`, in the `remote-agent` service `volumes` section (line 33), add after the existing volumes:

```yaml
      # Docker socket for container management
      - /var/run/docker.sock:/var/run/docker.sock
```

**Step 2: Add socket mount to docker-compose.dev.yml**

In `docker/docker-compose.dev.yml`, in the `api` service `volumes` section (line 33), add after the existing volumes:

```yaml
      # Docker socket for container management
      - /var/run/docker.sock:/var/run/docker.sock
```

**Step 3: Add socket mount to docker-compose.prod.yml**

In `docker/docker-compose.prod.yml`, in the `remote-agent` service `volumes` section (line 35), add after the existing volumes:

```yaml
      # Docker socket for container management
      - /var/run/docker.sock:/var/run/docker.sock
```

**Step 4: Commit**

```bash
git add docker/docker-compose.yml docker/docker-compose.dev.yml docker/docker-compose.prod.yml
git commit -m "feat: mount Docker socket in all compose configurations"
```

---

### Task 3: Fix Docker Socket Permissions in Entrypoint

**Files:**
- Modify: `docker/entrypoint.sh:1-10`

**Step 1: Add Docker socket permission fix**

In `docker/entrypoint.sh`, after `echo "Starting Remote Agent..."` (line 4) and before the "Fix ownership" comment (line 7), add:

```bash
# Fix Docker socket permissions — match host socket GID to container docker group
if [ -S /var/run/docker.sock ]; then
  SOCK_GID=$(stat -c '%g' /var/run/docker.sock)
  if getent group docker > /dev/null 2>&1; then
    groupmod -g "$SOCK_GID" docker 2>/dev/null || true
  else
    groupadd -g "$SOCK_GID" docker 2>/dev/null || true
  fi
  usermod -aG docker agent 2>/dev/null || true
  echo "Docker socket configured (GID: $SOCK_GID)"
fi
```

**Step 2: Commit**

```bash
git add docker/entrypoint.sh
git commit -m "feat: fix Docker socket permissions at container startup"
```

---

### Task 4: Create DockerService Backend

**Files:**
- Create: `packages/api/src/services/docker/docker.service.ts`
- Create: `packages/api/src/services/docker/index.ts`

**Step 1: Create the Docker service**

Create `packages/api/src/services/docker/docker.service.ts`:

```typescript
import { spawn } from 'bun';

export interface DockerContainer {
  id: string;
  names: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  createdAt: string;
}

export interface DockerFile {
  path: string;
  type: 'dockerfile' | 'compose';
  name: string;
}

const DOCKERFILE_PATTERN = /^Dockerfile(\..+)?$/i;
const COMPOSE_PATTERN = /^(docker-)?compose(\..+)?\.(yml|yaml)$/i;

class DockerService {
  /**
   * Run a docker CLI command and return stdout.
   * Throws on non-zero exit.
   */
  private async exec(args: string[]): Promise<string> {
    const proc = spawn(['docker', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(stderr.trim() || `docker ${args[0]} failed with exit code ${exitCode}`);
    }

    return stdout.trim();
  }

  async listContainers(): Promise<DockerContainer[]> {
    const format = '{{json .}}';
    const output = await this.exec(['ps', '-a', '--format', format]);
    if (!output) return [];

    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const raw = JSON.parse(line);
        return {
          id: raw.ID,
          names: raw.Names,
          image: raw.Image,
          status: raw.Status,
          state: raw.State,
          ports: raw.Ports,
          createdAt: raw.CreatedAt,
        };
      });
  }

  async startContainer(id: string): Promise<void> {
    await this.exec(['start', id]);
  }

  async stopContainer(id: string): Promise<void> {
    await this.exec(['stop', id]);
  }

  async restartContainer(id: string): Promise<void> {
    await this.exec(['restart', id]);
  }

  async removeContainer(id: string, force = false): Promise<void> {
    const args = ['rm'];
    if (force) args.push('-f');
    args.push(id);
    await this.exec(args);
  }

  /**
   * Returns the command array to stream logs for a container.
   * Used to spawn a process terminal for live log viewing.
   */
  getLogsCommand(containerId: string): string[] {
    return ['docker', 'logs', '--tail', '200', '-f', containerId];
  }

  async buildImage(dockerfilePath: string, contextDir: string, tag?: string): Promise<string> {
    const args = ['build', '-f', dockerfilePath];
    if (tag) args.push('-t', tag);
    args.push(contextDir);
    return this.exec(args);
  }

  async runContainer(opts: {
    image: string;
    name?: string;
    ports?: string[];
    env?: Record<string, string>;
    detach?: boolean;
  }): Promise<string> {
    const args = ['run'];
    if (opts.detach !== false) args.push('-d');
    if (opts.name) args.push('--name', opts.name);
    if (opts.ports) {
      for (const port of opts.ports) {
        args.push('-p', port);
      }
    }
    if (opts.env) {
      for (const [key, val] of Object.entries(opts.env)) {
        args.push('-e', `${key}=${val}`);
      }
    }
    args.push(opts.image);
    return this.exec(args);
  }

  async composeUp(composePath: string): Promise<string> {
    return this.exec(['compose', '-f', composePath, 'up', '-d']);
  }

  async composeDown(composePath: string): Promise<string> {
    return this.exec(['compose', '-f', composePath, 'down']);
  }

  async composePs(composePath: string): Promise<DockerContainer[]> {
    const format = '{{json .}}';
    const output = await this.exec(['compose', '-f', composePath, 'ps', '--format', format]);
    if (!output) return [];

    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const raw = JSON.parse(line);
        return {
          id: raw.ID,
          names: raw.Name || raw.Names,
          image: raw.Image,
          status: raw.Status,
          state: raw.State,
          ports: raw.Ports || raw.Publishers || '',
          createdAt: raw.CreatedAt || '',
        };
      });
  }

  /**
   * Scan a project directory for Dockerfiles and compose files.
   * Searches up to maxDepth levels deep.
   */
  async detectFiles(projectPath: string, maxDepth = 3): Promise<DockerFile[]> {
    const { readdir } = await import('fs/promises');
    const { join, relative } = await import('path');
    const results: DockerFile[] = [];

    const scan = async (dir: string, depth: number) => {
      if (depth > maxDepth) return;
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            // Skip common non-project directories
            if (['node_modules', '.git', 'dist', 'build', '.next', 'vendor'].includes(entry.name)) continue;
            await scan(join(dir, entry.name), depth + 1);
          } else if (entry.isFile()) {
            if (DOCKERFILE_PATTERN.test(entry.name)) {
              results.push({
                path: relative(projectPath, join(dir, entry.name)),
                type: 'dockerfile',
                name: entry.name,
              });
            } else if (COMPOSE_PATTERN.test(entry.name)) {
              results.push({
                path: relative(projectPath, join(dir, entry.name)),
                type: 'compose',
                name: entry.name,
              });
            }
          }
        }
      } catch {
        // Permission denied or other fs error — skip
      }
    };

    await scan(projectPath, 0);
    return results;
  }

  /**
   * Check if Docker is available on this system.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.exec(['info', '--format', '{{.ServerVersion}}']);
      return true;
    } catch {
      return false;
    }
  }
}

export const dockerService = new DockerService();
```

**Step 2: Create index export**

Create `packages/api/src/services/docker/index.ts`:

```typescript
export { dockerService } from './docker.service';
export type { DockerContainer, DockerFile } from './docker.service';
```

**Step 3: Commit**

```bash
git add packages/api/src/services/docker/
git commit -m "feat: add DockerService for container management via CLI"
```

---

### Task 5: Create Docker API Routes

**Files:**
- Create: `packages/api/src/routes/docker.routes.ts`
- Modify: `packages/api/src/routes/index.ts`

**Step 1: Create Docker routes**

Create `packages/api/src/routes/docker.routes.ts`:

```typescript
import { Elysia, t } from 'elysia';
import { requireAuth } from '../auth/middleware';
import { dockerService } from '../services/docker';
import { terminalService } from '../services/terminal';
import { nanoid } from 'nanoid';
import { db, projects } from '../db';
import { eq, and } from 'drizzle-orm';

export const dockerRoutes = new Elysia({ prefix: '/docker' })
  .use(requireAuth)

  // List all containers
  .get('/containers', async ({ set }) => {
    try {
      const containers = await dockerService.listContainers();
      return { containers };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  })

  // Start container
  .post('/containers/:id/start', async ({ params, set }) => {
    try {
      await dockerService.startContainer(params.id);
      return { success: true };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({ id: t.String() }),
  })

  // Stop container
  .post('/containers/:id/stop', async ({ params, set }) => {
    try {
      await dockerService.stopContainer(params.id);
      return { success: true };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({ id: t.String() }),
  })

  // Restart container
  .post('/containers/:id/restart', async ({ params, set }) => {
    try {
      await dockerService.restartContainer(params.id);
      return { success: true };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({ id: t.String() }),
  })

  // Remove container
  .delete('/containers/:id', async ({ params, query, set }) => {
    try {
      await dockerService.removeContainer(params.id, query.force === 'true');
      return { success: true };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({ id: t.String() }),
    query: t.Object({ force: t.Optional(t.String()) }),
  })

  // View container logs — creates a process terminal
  .post('/containers/:id/logs', async ({ params, body, set }) => {
    try {
      const container = (await dockerService.listContainers()).find(
        (c) => c.id === params.id || c.names === params.id
      );
      const terminalId = nanoid();
      const command = dockerService.getLogsCommand(params.id);

      await terminalService.createTerminal({
        terminalId,
        sessionId: body.sessionId,
        name: `logs: ${container?.names || params.id}`,
        type: 'process',
        command,
        cwd: '/tmp',
      });

      return { success: true, terminalId };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ sessionId: t.String() }),
  })

  // Build image from Dockerfile
  .post('/build', async ({ body, set }) => {
    try {
      const output = await dockerService.buildImage(body.dockerfilePath, body.contextDir, body.tag);
      return { success: true, output };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    body: t.Object({
      dockerfilePath: t.String(),
      contextDir: t.String(),
      tag: t.Optional(t.String()),
    }),
  })

  // Run a container from an image
  .post('/run', async ({ body, set }) => {
    try {
      const containerId = await dockerService.runContainer({
        image: body.image,
        name: body.name,
        ports: body.ports,
        env: body.env,
      });
      return { success: true, containerId: containerId.trim() };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    body: t.Object({
      image: t.String(),
      name: t.Optional(t.String()),
      ports: t.Optional(t.Array(t.String())),
      env: t.Optional(t.Record(t.String(), t.String())),
    }),
  })

  // Docker Compose up
  .post('/compose/up', async ({ body, set }) => {
    try {
      const output = await dockerService.composeUp(body.composePath);
      return { success: true, output };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    body: t.Object({ composePath: t.String() }),
  })

  // Docker Compose down
  .post('/compose/down', async ({ body, set }) => {
    try {
      const output = await dockerService.composeDown(body.composePath);
      return { success: true, output };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    body: t.Object({ composePath: t.String() }),
  })

  // Docker Compose ps
  .get('/compose/ps', async ({ query, set }) => {
    try {
      const containers = await dockerService.composePs(query.composePath);
      return { containers };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    query: t.Object({ composePath: t.String() }),
  })

  // Detect Docker files in a project
  .get('/detect/:projectId', async ({ user, params, set }) => {
    try {
      const project = await db.query.projects.findFirst({
        where: and(
          eq(projects.id, params.projectId),
          eq(projects.userId, user!.id),
        ),
      });

      if (!project) {
        set.status = 404;
        return { error: 'Project not found' };
      }

      const files = await dockerService.detectFiles(project.localPath);
      return { files };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({ projectId: t.String() }),
  })

  // Check Docker availability
  .get('/status', async ({ set }) => {
    try {
      const available = await dockerService.isAvailable();
      return { available };
    } catch {
      return { available: false };
    }
  });
```

**Step 2: Register in routes index**

In `packages/api/src/routes/index.ts`, add import and use:

Add at line 16 (after the `previewRoutes` import):
```typescript
import { dockerRoutes } from './docker.routes';
```

Add `.use(dockerRoutes)` before `.use(presenceRoutes)` (line 31):
```typescript
  .use(dockerRoutes)
```

**Step 3: Commit**

```bash
git add packages/api/src/routes/docker.routes.ts packages/api/src/routes/index.ts
git commit -m "feat: add Docker API routes for container management"
```

---

### Task 6: Add Docker API Methods to Frontend

**Files:**
- Modify: `packages/ui/src/lib/api.ts`

**Step 1: Add Docker types**

At the end of `packages/ui/src/lib/api.ts`, before the closing (after `SidebarData` interface around line 905), add:

```typescript
// ─── Docker Types ────────────────────────────────────────────────────────────

export interface DockerContainer {
  id: string;
  names: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  createdAt: string;
}

export interface DockerFile {
  path: string;
  type: 'dockerfile' | 'compose';
  name: string;
}
```

**Step 2: Add Docker API methods**

In the `api` object, after the `getSidebarData` method (around line 397), add:

```typescript
  // ─── Docker ──────────────────────────────────────────────────────────────

  getDockerContainers: () =>
    request<{ containers: DockerContainer[] }>('/docker/containers'),
  startDockerContainer: (id: string) =>
    request<{ success: boolean }>(`/docker/containers/${id}/start`, { method: 'POST' }),
  stopDockerContainer: (id: string) =>
    request<{ success: boolean }>(`/docker/containers/${id}/stop`, { method: 'POST' }),
  restartDockerContainer: (id: string) =>
    request<{ success: boolean }>(`/docker/containers/${id}/restart`, { method: 'POST' }),
  removeDockerContainer: (id: string, force = false) =>
    request<{ success: boolean }>(`/docker/containers/${id}${force ? '?force=true' : ''}`, { method: 'DELETE' }),
  viewContainerLogs: (containerId: string, sessionId: string) =>
    request<{ success: boolean; terminalId: string }>(`/docker/containers/${containerId}/logs`, {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),
  dockerBuild: (dockerfilePath: string, contextDir: string, tag?: string) =>
    request<{ success: boolean; output: string }>('/docker/build', {
      method: 'POST',
      body: JSON.stringify({ dockerfilePath, contextDir, tag }),
    }),
  dockerRun: (data: { image: string; name?: string; ports?: string[]; env?: Record<string, string> }) =>
    request<{ success: boolean; containerId: string }>('/docker/run', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  dockerComposeUp: (composePath: string) =>
    request<{ success: boolean; output: string }>('/docker/compose/up', {
      method: 'POST',
      body: JSON.stringify({ composePath }),
    }),
  dockerComposeDown: (composePath: string) =>
    request<{ success: boolean; output: string }>('/docker/compose/down', {
      method: 'POST',
      body: JSON.stringify({ composePath }),
    }),
  dockerComposePs: (composePath: string) =>
    request<{ containers: DockerContainer[] }>(`/docker/compose/ps?composePath=${encodeURIComponent(composePath)}`),
  detectDockerFiles: (projectId: string) =>
    request<{ files: DockerFile[] }>(`/docker/detect/${projectId}`),
  getDockerStatus: () =>
    request<{ available: boolean }>('/docker/status'),
```

**Step 3: Commit**

```bash
git add packages/ui/src/lib/api.ts
git commit -m "feat: add Docker API client methods and types"
```

---

### Task 7: Create useDocker Hook

**Files:**
- Create: `packages/ui/src/hooks/useDocker.ts`

**Step 1: Create the hook**

Create `packages/ui/src/hooks/useDocker.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useDocker(projectId?: string) {
  const queryClient = useQueryClient();

  const invalidateContainers = () => {
    queryClient.invalidateQueries({ queryKey: ['docker-containers'] });
  };

  const { data: containersData, isLoading: isLoadingContainers } = useQuery({
    queryKey: ['docker-containers'],
    queryFn: () => api.getDockerContainers(),
    refetchInterval: 5000,
  });

  const { data: dockerFiles, isLoading: isLoadingFiles } = useQuery({
    queryKey: ['docker-files', projectId],
    queryFn: () => api.detectDockerFiles(projectId!),
    enabled: !!projectId,
  });

  const { data: dockerStatus } = useQuery({
    queryKey: ['docker-status'],
    queryFn: () => api.getDockerStatus(),
    staleTime: 60_000,
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => api.startDockerContainer(id),
    onSuccess: invalidateContainers,
  });

  const stopMutation = useMutation({
    mutationFn: (id: string) => api.stopDockerContainer(id),
    onSuccess: invalidateContainers,
  });

  const restartMutation = useMutation({
    mutationFn: (id: string) => api.restartDockerContainer(id),
    onSuccess: invalidateContainers,
  });

  const removeMutation = useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) =>
      api.removeDockerContainer(id, force),
    onSuccess: invalidateContainers,
  });

  const logsMutation = useMutation({
    mutationFn: ({ containerId, sessionId }: { containerId: string; sessionId: string }) =>
      api.viewContainerLogs(containerId, sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['terminals'] });
    },
  });

  const runMutation = useMutation({
    mutationFn: (data: { image: string; name?: string; ports?: string[]; env?: Record<string, string> }) =>
      api.dockerRun(data),
    onSuccess: invalidateContainers,
  });

  const buildMutation = useMutation({
    mutationFn: (data: { dockerfilePath: string; contextDir: string; tag?: string }) =>
      api.dockerBuild(data.dockerfilePath, data.contextDir, data.tag),
    onSuccess: invalidateContainers,
  });

  const composeUpMutation = useMutation({
    mutationFn: (composePath: string) => api.dockerComposeUp(composePath),
    onSuccess: invalidateContainers,
  });

  const composeDownMutation = useMutation({
    mutationFn: (composePath: string) => api.dockerComposeDown(composePath),
    onSuccess: invalidateContainers,
  });

  return {
    containers: containersData?.containers || [],
    dockerFiles: dockerFiles?.files || [],
    isAvailable: dockerStatus?.available ?? false,
    isLoadingContainers,
    isLoadingFiles,
    start: startMutation.mutateAsync,
    stop: stopMutation.mutateAsync,
    restart: restartMutation.mutateAsync,
    remove: removeMutation.mutateAsync,
    viewLogs: logsMutation.mutateAsync,
    run: runMutation.mutateAsync,
    build: buildMutation.mutateAsync,
    composeUp: composeUpMutation.mutateAsync,
    composeDown: composeDownMutation.mutateAsync,
    isRunning: runMutation.isPending,
    isBuilding: buildMutation.isPending,
  };
}
```

**Step 2: Commit**

```bash
git add packages/ui/src/hooks/useDocker.ts
git commit -m "feat: add useDocker hook for container management"
```

---

### Task 8: Create DockerPanel Component

**Files:**
- Create: `packages/ui/src/components/DockerPanel.tsx`

**Step 1: Create the DockerPanel**

Create `packages/ui/src/components/DockerPanel.tsx`:

```tsx
import { useState } from 'react';
import {
  Play,
  Square,
  RotateCw,
  Trash2,
  FileText,
  Box,
  Plus,
  ChevronDown,
  ChevronRight,
  ArrowUpFromLine,
  ArrowDownToLine,
  Hammer,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useDocker } from '@/hooks/useDocker';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toaster';
import type { DockerContainer, DockerFile } from '@/lib/api';

interface DockerPanelProps {
  sessionId: string;
  projectId?: string;
  onTerminalCreated?: (terminalId: string) => void;
}

export function DockerPanel({ sessionId, projectId, onTerminalCreated }: DockerPanelProps) {
  const {
    containers,
    dockerFiles,
    isAvailable,
    isLoadingContainers,
    start,
    stop,
    restart,
    remove,
    viewLogs,
    run,
    composeUp,
    composeDown,
    isRunning,
  } = useDocker(projectId);

  const [actionPending, setActionPending] = useState<string | null>(null);
  const [showRunForm, setShowRunForm] = useState(false);
  const [showContainers, setShowContainers] = useState(true);
  const [showFiles, setShowFiles] = useState(true);

  // Quick Run form state
  const [runImage, setRunImage] = useState('');
  const [runName, setRunName] = useState('');
  const [runPorts, setRunPorts] = useState('');

  if (!isAvailable) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
        <Box className="h-10 w-10 mb-3 opacity-30" />
        <p className="text-sm mb-1">Docker not available</p>
        <p className="text-xs">Mount /var/run/docker.sock to enable</p>
      </div>
    );
  }

  const handleAction = async (id: string, action: () => Promise<unknown>, label: string) => {
    setActionPending(id);
    try {
      await action();
      toast({ title: label, description: 'Success' });
    } catch (error) {
      toast({ title: `Failed: ${label}`, description: (error as Error).message, variant: 'destructive' });
    } finally {
      setActionPending(null);
    }
  };

  const handleViewLogs = async (container: DockerContainer) => {
    setActionPending(container.id);
    try {
      const result = await viewLogs({ containerId: container.id, sessionId });
      onTerminalCreated?.(result.terminalId);
    } catch (error) {
      toast({ title: 'Failed to open logs', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setActionPending(null);
    }
  };

  const handleRun = async () => {
    if (!runImage.trim()) return;
    try {
      const ports = runPorts.trim() ? runPorts.split(',').map((p) => p.trim()) : undefined;
      await run({ image: runImage.trim(), name: runName.trim() || undefined, ports });
      toast({ title: 'Container started', description: runImage });
      setShowRunForm(false);
      setRunImage('');
      setRunName('');
      setRunPorts('');
    } catch (error) {
      toast({ title: 'Failed to run', description: (error as Error).message, variant: 'destructive' });
    }
  };

  const handleComposeUp = async (file: DockerFile) => {
    handleAction(file.path, () => composeUp(file.path), `Compose Up: ${file.name}`);
  };

  const handleComposeDown = async (file: DockerFile) => {
    handleAction(file.path, () => composeDown(file.path), `Compose Down: ${file.name}`);
  };

  const dockerfileFiles = dockerFiles.filter((f) => f.type === 'dockerfile');
  const composeFiles = dockerFiles.filter((f) => f.type === 'compose');

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <h2 className="font-semibold text-sm">Docker</h2>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 h-7 px-2 text-xs"
          onClick={() => setShowRunForm(!showRunForm)}
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Run</span>
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Quick Run Form */}
        {showRunForm && (
          <div className="px-4 py-3 border-b space-y-2">
            <input
              type="text"
              value={runImage}
              onChange={(e) => setRunImage(e.target.value)}
              placeholder="Image (e.g. redis:alpine)"
              className="w-full h-8 px-2 rounded border border-input bg-transparent text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleRun()}
            />
            <div className="flex gap-2">
              <input
                type="text"
                value={runName}
                onChange={(e) => setRunName(e.target.value)}
                placeholder="Name (optional)"
                className="flex-1 h-8 px-2 rounded border border-input bg-transparent text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <input
                type="text"
                value={runPorts}
                onChange={(e) => setRunPorts(e.target.value)}
                placeholder="Ports (e.g. 6379:6379)"
                className="flex-1 h-8 px-2 rounded border border-input bg-transparent text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowRunForm(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleRun} disabled={!runImage.trim() || isRunning}>
                {isRunning ? <RotateCw className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
                Run
              </Button>
            </div>
          </div>
        )}

        {/* Containers Section */}
        <div>
          <button
            onClick={() => setShowContainers(!showContainers)}
            className="flex items-center gap-2 w-full px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-accent/50 uppercase tracking-wider"
          >
            {showContainers ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Containers ({containers.length})
          </button>
          {showContainers && (
            isLoadingContainers ? (
              <div className="px-4 py-4 text-sm text-muted-foreground text-center">Loading...</div>
            ) : containers.length === 0 ? (
              <div className="px-4 py-4 text-sm text-muted-foreground text-center">No containers</div>
            ) : (
              <div className="divide-y">
                {containers.map((container) => (
                  <ContainerItem
                    key={container.id}
                    container={container}
                    isPending={actionPending === container.id}
                    onStart={() => handleAction(container.id, () => start(container.id), `Started ${container.names}`)}
                    onStop={() => handleAction(container.id, () => stop(container.id), `Stopped ${container.names}`)}
                    onRestart={() => handleAction(container.id, () => restart(container.id), `Restarted ${container.names}`)}
                    onRemove={() => handleAction(container.id, () => remove({ id: container.id, force: true }), `Removed ${container.names}`)}
                    onViewLogs={() => handleViewLogs(container)}
                  />
                ))}
              </div>
            )
          )}
        </div>

        {/* Detected Files Section */}
        {projectId && (dockerfileFiles.length > 0 || composeFiles.length > 0) && (
          <div>
            <button
              onClick={() => setShowFiles(!showFiles)}
              className="flex items-center gap-2 w-full px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-accent/50 uppercase tracking-wider"
            >
              {showFiles ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Detected Files ({dockerFiles.length})
            </button>
            {showFiles && (
              <div className="divide-y">
                {dockerfileFiles.map((file) => (
                  <div key={file.path} className="flex items-center gap-2 px-4 py-2.5 hover:bg-accent/50 group">
                    <FileText className="h-4 w-4 text-blue-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-mono truncate block">{file.path}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={() => handleAction(file.path, () => api.dockerBuild(file.path, '.'), `Build: ${file.name}`)}
                      disabled={actionPending === file.path}
                    >
                      <Hammer className="h-3 w-3" />
                      Build
                    </Button>
                  </div>
                ))}
                {composeFiles.map((file) => (
                  <div key={file.path} className="flex items-center gap-2 px-4 py-2.5 hover:bg-accent/50 group">
                    <FileText className="h-4 w-4 text-purple-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-mono truncate block">{file.path}</span>
                    </div>
                    <div className="flex gap-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1 text-green-500 hover:text-green-500"
                        onClick={() => handleComposeUp(file)}
                        disabled={actionPending === file.path}
                      >
                        <ArrowUpFromLine className="h-3 w-3" />
                        Up
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive"
                        onClick={() => handleComposeDown(file)}
                        disabled={actionPending === file.path}
                      >
                        <ArrowDownToLine className="h-3 w-3" />
                        Down
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Need to import api for inline build call in Dockerfile section
import { api } from '@/lib/api';

interface ContainerItemProps {
  container: DockerContainer;
  isPending: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onRemove: () => void;
  onViewLogs: () => void;
}

function ContainerItem({ container, isPending, onStart, onStop, onRestart, onRemove, onViewLogs }: ContainerItemProps) {
  const isRunning = container.state === 'running';
  const isPaused = container.state === 'paused';

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-accent/50 group">
      {/* Status */}
      <div
        className={cn(
          'h-2 w-2 rounded-full shrink-0',
          isRunning ? 'bg-green-500' : isPaused ? 'bg-yellow-500' : 'bg-muted-foreground/30'
        )}
      />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{container.names}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono truncate max-w-32">
            {container.image}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground truncate">{container.status}</p>
          {container.ports && (
            <p className="text-xs text-muted-foreground font-mono truncate">{container.ports}</p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onViewLogs}
          disabled={isPending}
          title="View Logs"
        >
          <FileText className="h-3.5 w-3.5" />
        </Button>
        {isRunning ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onRestart}
              disabled={isPending}
              title="Restart"
            >
              <RotateCw className={cn('h-3.5 w-3.5', isPending && 'animate-spin')} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={onStop}
              disabled={isPending}
              title="Stop"
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-green-500 hover:text-green-500"
              onClick={onStart}
              disabled={isPending}
              title="Start"
            >
              <Play className={cn('h-3.5 w-3.5', isPending && 'animate-pulse')} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={onRemove}
              disabled={isPending}
              title="Remove"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/ui/src/components/DockerPanel.tsx
git commit -m "feat: add DockerPanel component for container management UI"
```

---

### Task 9: Integrate Docker Tab into Session Page

**Files:**
- Modify: `packages/ui/src/pages/Session.tsx`

**Step 1: Add Docker to ViewMode and imports**

At line 1 of `Session.tsx`, add `Box` to the lucide imports:

```typescript
import {
  ArrowLeft,
  Bot,
  TerminalSquare,
  Plus,
  GitBranch,
  X,
  RefreshCw,
  PanelRightClose,
  PanelRight,
  ChevronDown,
  FolderOpen,
  Trash2,
  Play,
  Monitor,
  Box,
} from 'lucide-react';
```

Add the DockerPanel import after the other component imports (around line 26):
```typescript
import { DockerPanel } from '@/components/DockerPanel';
```

Change the ViewMode type at line 30:
```typescript
type ViewMode = 'terminal' | 'git' | 'files' | 'run' | 'preview' | 'docker';
```

**Step 2: Add Docker toolbar button**

After the Run Configs toggle button (after line 236, the closing `)}` of the Run button block), add:

```tsx
        {/* Docker Toggle */}
        <Button
          variant={viewMode === 'docker' ? 'secondary' : 'ghost'}
          size="sm"
          className="gap-1.5 h-8 px-2.5 font-mono text-xs"
          onClick={() => setViewMode(viewMode === 'docker' ? 'terminal' : 'docker')}
        >
          <Box className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Docker</span>
        </Button>
```

**Step 3: Add Docker content rendering**

In the main content area, after the `viewMode === 'run'` block (after line 529), add a new branch before the preview check:

```tsx
            ) : viewMode === 'docker' ? (
              <DockerPanel
                sessionId={id!}
                projectId={session?.project?.id}
                onTerminalCreated={(terminalId) => {
                  queryClient.invalidateQueries({ queryKey: ['terminals', id] });
                  selectTerminal(terminalId);
                  setViewMode('terminal');
                }}
              />
```

**Step 4: Commit**

```bash
git add packages/ui/src/pages/Session.tsx
git commit -m "feat: integrate Docker tab into session page"
```

---

### Task 10: Add Docker Actions to File Context Menu

**Files:**
- Modify: `packages/ui/src/components/FileContextMenu.tsx`

**Step 1: Add Docker context actions**

Update the `ContextAction` type and add Docker-specific menu items:

```typescript
import * as ContextMenu from '@radix-ui/react-context-menu';
import { Upload, Copy, Move, Trash2, Hammer, ArrowUpFromLine, ArrowDownToLine } from 'lucide-react';

export type ContextAction = 'upload' | 'copy' | 'move' | 'delete' | 'docker-build' | 'compose-up' | 'compose-down';

const DOCKERFILE_PATTERN = /^Dockerfile(\..+)?$/i;
const COMPOSE_PATTERN = /^(docker-)?compose(\..+)?\.(yml|yaml)$/i;

interface FileContextMenuProps {
  entryType: 'file' | 'directory';
  fileName: string;
  children: React.ReactNode;
  onAction: (action: ContextAction) => void;
}

export function FileContextMenu({ entryType, fileName, children, onAction }: FileContextMenuProps) {
  const isDockerfile = DOCKERFILE_PATTERN.test(fileName);
  const isCompose = COMPOSE_PATTERN.test(fileName);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="min-w-[160px] rounded-md border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95 z-50"
        >
          {/* Docker actions */}
          {isDockerfile && (
            <>
              <ContextMenu.Item
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm cursor-pointer outline-none hover:bg-accent"
                onSelect={() => onAction('docker-build')}
              >
                <Hammer className="h-3.5 w-3.5" />
                Build Image
              </ContextMenu.Item>
              <ContextMenu.Separator className="h-px bg-border my-1" />
            </>
          )}

          {isCompose && (
            <>
              <ContextMenu.Item
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm cursor-pointer outline-none hover:bg-accent text-green-500"
                onSelect={() => onAction('compose-up')}
              >
                <ArrowUpFromLine className="h-3.5 w-3.5" />
                Compose Up
              </ContextMenu.Item>
              <ContextMenu.Item
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm cursor-pointer outline-none hover:bg-accent text-destructive"
                onSelect={() => onAction('compose-down')}
              >
                <ArrowDownToLine className="h-3.5 w-3.5" />
                Compose Down
              </ContextMenu.Item>
              <ContextMenu.Separator className="h-px bg-border my-1" />
            </>
          )}

          {entryType === 'directory' && (
            <ContextMenu.Item
              className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm cursor-pointer outline-none hover:bg-accent"
              onSelect={() => onAction('upload')}
            >
              <Upload className="h-3.5 w-3.5" />
              Upload Files
            </ContextMenu.Item>
          )}

          <ContextMenu.Item
            className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm cursor-pointer outline-none hover:bg-accent"
            onSelect={() => onAction('copy')}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy to...
          </ContextMenu.Item>

          <ContextMenu.Item
            className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm cursor-pointer outline-none hover:bg-accent"
            onSelect={() => onAction('move')}
          >
            <Move className="h-3.5 w-3.5" />
            Move to...
          </ContextMenu.Item>

          <ContextMenu.Separator className="h-px bg-border my-1" />

          <ContextMenu.Item
            className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm cursor-pointer outline-none hover:bg-accent text-destructive"
            onSelect={() => onAction('delete')}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
```

**Step 2: Update FileContextMenu consumers to pass fileName**

The `FileContextMenu` component is used in the `FileTree` component. You need to find where `FileContextMenu` is rendered and add the `fileName` prop. Search for `<FileContextMenu` in the codebase and update all call sites to pass `fileName={entry.name}` (or equivalent).

Also, handle the new Docker context actions in the `onAction` callback where `FileContextMenu` is used. For `docker-build` and `compose-up`/`compose-down`, call the appropriate `api.dockerBuild()`, `api.dockerComposeUp()`, or `api.dockerComposeDown()` with the file's path and show a toast.

**Step 3: Commit**

```bash
git add packages/ui/src/components/FileContextMenu.tsx
git commit -m "feat: add Docker build/compose actions to file context menu"
```

---

### Task 11: Update FileTree to Pass fileName and Handle Docker Actions

**Files:**
- Modify: `packages/ui/src/components/FileTree.tsx` (find the file — it renders `FileContextMenu`)

**Step 1: Pass fileName to FileContextMenu**

Find all `<FileContextMenu` usages in `FileTree.tsx` and add `fileName={entry.name}` prop.

**Step 2: Handle Docker context actions**

In the `onAction` handler for `FileContextMenu`, add cases for the new Docker actions:

```typescript
case 'docker-build':
  api.dockerBuild(entry.path, dirname(entry.path) || '.')
    .then(() => toast({ title: 'Build started', description: entry.name }))
    .catch((err) => toast({ title: 'Build failed', description: err.message, variant: 'destructive' }));
  break;
case 'compose-up':
  api.dockerComposeUp(entry.path)
    .then(() => toast({ title: 'Compose Up', description: entry.name }))
    .catch((err) => toast({ title: 'Compose Up failed', description: err.message, variant: 'destructive' }));
  break;
case 'compose-down':
  api.dockerComposeDown(entry.path)
    .then(() => toast({ title: 'Compose Down', description: entry.name }))
    .catch((err) => toast({ title: 'Compose Down failed', description: err.message, variant: 'destructive' }));
  break;
```

**Step 3: Commit**

```bash
git add packages/ui/src/components/FileTree.tsx
git commit -m "feat: handle Docker context menu actions in file tree"
```

---

### Task 12: Build and Verify

**Step 1: Build the project**

```bash
cd /app/workspaces/qRler1aMqKwOsAPH2IEdKf9SWyg6YSVX/remote-agent && bun run build:ui
```

Expected: Clean build with no TypeScript errors.

**Step 2: Fix any type errors found during build**

If there are TypeScript errors, fix them. Common issues:
- Missing `fileName` prop on existing `FileContextMenu` call sites
- Import path issues for new components
- Type mismatches between API response and component props

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build errors in Docker integration"
```

---

### Task 13: Final Review

**Step 1: Verify all files are committed**

```bash
git status
git log --oneline -10
```

**Step 2: Manual verification checklist**

- [ ] Docker CLI installed in container image
- [ ] Socket mount added to all 3 compose files
- [ ] Entrypoint fixes socket permissions
- [ ] DockerService wraps all needed CLI commands
- [ ] Routes registered and auth-protected
- [ ] Frontend API methods match route signatures
- [ ] DockerPanel renders containers, detected files, and run form
- [ ] Session.tsx has Docker toolbar button and content branch
- [ ] FileContextMenu shows Docker actions for matching filenames
- [ ] FileTree handles Docker context actions
