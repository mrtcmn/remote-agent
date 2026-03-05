import { Elysia, t } from 'elysia';
import { requireAuth } from '../auth/middleware';
import { dockerService } from '../services/docker';
import { terminalService } from '../services/terminal';
import { nanoid } from 'nanoid';
import { db, projects, claudeSessions, projectLinks } from '../db';
import { eq, and } from 'drizzle-orm';
import { resolve } from 'path';
import { realpath } from 'fs/promises';

/** Resolve a relative file path to an absolute path using the session's project root.
 *  Validates path stays within project boundaries (including multi-project symlinks). */
async function resolveSessionFilePath(
  sessionId: string,
  userId: string,
  relativePath: string,
  set: { status?: number | string }
): Promise<string | null> {
  const session = await db.query.claudeSessions.findFirst({
    where: and(
      eq(claudeSessions.id, sessionId),
      eq(claudeSessions.userId, userId)
    ),
    with: { project: true },
  });

  if (!session?.project) {
    set.status = 404;
    return null;
  }

  const projectRoot = resolve(session.project.localPath);
  const fullPath = resolve(projectRoot, relativePath);

  // Traversal check: resolved path must be within project root
  if (fullPath !== projectRoot && !fullPath.startsWith(projectRoot + '/')) {
    set.status = 403;
    return null;
  }

  // Resolve symlinks and re-check (handles multi-project workspaces)
  try {
    const realFullPath = await realpath(fullPath);
    const realProjectRoot = await realpath(projectRoot);
    if (realFullPath === realProjectRoot || realFullPath.startsWith(realProjectRoot + '/')) {
      return realFullPath;
    }

    // For multi-project sessions, check allowed child project paths
    if (session.project.isMultiProject) {
      const links = await db.query.projectLinks.findMany({
        where: eq(projectLinks.parentProjectId, session.project.id),
        with: { childProject: true },
      });
      for (const link of links) {
        const childPath = (link as any).childProject?.localPath;
        if (!childPath) continue;
        try {
          const realAllowed = await realpath(childPath);
          if (realFullPath === realAllowed || realFullPath.startsWith(realAllowed + '/')) {
            return realFullPath;
          }
        } catch {
          // Skip invalid child paths
        }
      }
    }

    set.status = 403;
    return null;
  } catch {
    // Path doesn't exist yet but resolved path was within bounds
    return fullPath;
  }
}

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
      const containers = await dockerService.listContainers();
      const container = containers.find(
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
  .post('/build', async ({ user, body, set }) => {
    try {
      let dockerfilePath = body.dockerfilePath;
      let contextDir = body.contextDir;
      if (body.sessionId) {
        const resolved = await resolveSessionFilePath(body.sessionId, user!.id, dockerfilePath, set);
        if (!resolved) return { error: 'Session not found' };
        dockerfilePath = resolved;
        // Resolve contextDir relative to session project root too
        const resolvedCtx = await resolveSessionFilePath(body.sessionId, user!.id, contextDir, set);
        if (!resolvedCtx) return { error: 'Session not found' };
        contextDir = resolvedCtx;
      }
      const output = await dockerService.buildImage(dockerfilePath, contextDir, body.tag);
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
      sessionId: t.Optional(t.String()),
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
  .post('/compose/up', async ({ user, body, set }) => {
    try {
      let composePath = body.composePath;
      if (body.sessionId) {
        const resolved = await resolveSessionFilePath(body.sessionId, user!.id, composePath, set);
        if (!resolved) return { error: 'Session not found' };
        composePath = resolved;
      }
      const output = await dockerService.composeUp(composePath);
      return { success: true, output };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    body: t.Object({ composePath: t.String(), sessionId: t.Optional(t.String()) }),
  })

  // Docker Compose down
  .post('/compose/down', async ({ user, body, set }) => {
    try {
      let composePath = body.composePath;
      if (body.sessionId) {
        const resolved = await resolveSessionFilePath(body.sessionId, user!.id, composePath, set);
        if (!resolved) return { error: 'Session not found' };
        composePath = resolved;
      }
      const output = await dockerService.composeDown(composePath);
      return { success: true, output };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    body: t.Object({ composePath: t.String(), sessionId: t.Optional(t.String()) }),
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
  .get('/status', async () => {
    try {
      const available = await dockerService.isAvailable();
      return { available };
    } catch {
      return { available: false };
    }
  });
