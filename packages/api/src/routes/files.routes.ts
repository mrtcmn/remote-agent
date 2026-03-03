import { Elysia, t } from 'elysia';
import { eq, and } from 'drizzle-orm';
import { db, claudeSessions } from '../db';
import { requireAuth } from '../auth/middleware';
import { readdir, stat, readFile, realpath, unlink, rm, copyFile, cp, rename, mkdir } from 'fs/promises';
import { join, resolve, basename, dirname } from 'path';

/** Resolve a path and verify it stays within the project root (prevents traversal and symlink escape) */
async function validatePath(projectPath: string, requestedPath: string): Promise<string | null> {
  const projectRoot = resolve(projectPath);
  const fullPath = resolve(projectPath, requestedPath);

  // Check resolved path is within project (with trailing slash to prevent prefix bypass)
  if (fullPath !== projectRoot && !fullPath.startsWith(projectRoot + '/')) {
    return null;
  }

  // Resolve symlinks and re-check
  try {
    const realFullPath = await realpath(fullPath);
    const realProjectRoot = await realpath(projectRoot);
    if (realFullPath !== realProjectRoot && !realFullPath.startsWith(realProjectRoot + '/')) {
      return null;
    }
    return realFullPath;
  } catch {
    // Path doesn't exist yet, but the resolved path was within bounds
    return fullPath;
  }
}

/** Look up session + project, verify ownership. Returns project path or sets error on `set`. */
async function getSessionProject(
  sessionId: string,
  userId: string,
  set: { status?: number | string }
): Promise<string | null> {
  const session = await db.query.claudeSessions.findFirst({
    where: and(
      eq(claudeSessions.id, sessionId),
      eq(claudeSessions.userId, userId)
    ),
    with: { project: true },
  });

  if (!session) {
    set.status = 404;
    return null;
  }
  if (!session.project) {
    set.status = 400;
    return null;
  }
  return session.project.localPath;
}

export const fileRoutes = new Elysia({ prefix: '/sessions/:id/files' })
  .use(requireAuth)

  // List directory contents
  .get('/', async ({ user, params, query, set }) => {
    const projectPath = await getSessionProject(params.id, user!.id, set);
    if (!projectPath) {
      return { error: set.status === 404 ? 'Session not found' : 'Session has no project' };
    }

    const requestedPath = query.path || '.';

    const validatedPath = await validatePath(projectPath, requestedPath);
    if (!validatedPath) {
      set.status = 403;
      return { error: 'Path traversal not allowed' };
    }

    try {
      const entries = await readdir(validatedPath, { withFileTypes: true });
      const result = await Promise.all(
        entries
          .filter(entry => !entry.name.startsWith('.'))
          .map(async (entry) => {
            const entryPath = join(requestedPath === '.' ? '' : requestedPath, entry.name);
            const item: { name: string; path: string; type: 'file' | 'directory'; size?: number } = {
              name: entry.name,
              path: entryPath,
              type: entry.isDirectory() ? 'directory' : 'file',
            };
            if (!entry.isDirectory()) {
              try {
                const s = await stat(join(validatedPath, entry.name));
                item.size = s.size;
              } catch {}
            }
            return item;
          })
      );

      // Sort: directories first, then files, alphabetical
      result.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return { path: requestedPath, entries: result };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        set.status = 404;
        return { error: 'Path not found' };
      }
      set.status = 500;
      return { error: 'Failed to read directory' };
    }
  }, {
    params: t.Object({ id: t.String() }),
    query: t.Object({ path: t.Optional(t.String()) }),
  })

  // Read file content
  .get('/content', async ({ user, params, query, set }) => {
    const projectPath = await getSessionProject(params.id, user!.id, set);
    if (!projectPath) {
      return { error: set.status === 404 ? 'Session not found' : 'Session has no project' };
    }

    const requestedPath = query.path;

    if (!requestedPath) {
      set.status = 400;
      return { error: 'Path is required' };
    }

    const validatedPath = await validatePath(projectPath, requestedPath);
    if (!validatedPath) {
      set.status = 403;
      return { error: 'Path traversal not allowed' };
    }

    try {
      const fileStat = await stat(validatedPath);

      if (!fileStat.isFile()) {
        set.status = 400;
        return { error: 'Not a regular file' };
      }

      // Reject large files (> 1MB)
      if (fileStat.size > 1024 * 1024) {
        set.status = 400;
        return { error: 'File too large to display' };
      }

      const content = await readFile(validatedPath, 'utf-8');
      return {
        path: requestedPath,
        name: basename(validatedPath),
        content,
        size: fileStat.size,
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        set.status = 404;
        return { error: 'File not found' };
      }
      set.status = 500;
      return { error: 'Failed to read file' };
    }
  }, {
    params: t.Object({ id: t.String() }),
    query: t.Object({ path: t.String() }),
  })

  // Upload files
  .post('/upload', async ({ user, params, body, set }) => {
    const projectPath = await getSessionProject(params.id, user!.id, set);
    if (!projectPath) {
      return { error: set.status === 404 ? 'Session not found' : 'Session has no project' };
    }

    const directory = body.directory || '.';
    const validatedDir = await validatePath(projectPath, directory);
    if (!validatedDir) {
      set.status = 403;
      return { error: 'Path traversal not allowed' };
    }

    const files = body.files;
    const fileArray = Array.isArray(files) ? files : [files];

    const uploaded: string[] = [];
    for (const file of fileArray) {
      if (!(file instanceof File)) continue;
      const destPath = join(validatedDir, file.name);

      // Re-validate each destination to prevent name-based traversal (e.g. "../foo")
      const validatedDest = await validatePath(projectPath, join(directory, file.name));
      if (!validatedDest) {
        set.status = 403;
        return { error: 'Path traversal not allowed' };
      }

      await mkdir(dirname(destPath), { recursive: true });
      await Bun.write(destPath, file);
      uploaded.push(join(directory, file.name));
    }

    return { success: true, uploaded };
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      files: t.Union([t.File(), t.Array(t.File())]),
      directory: t.Optional(t.String()),
    }),
    type: 'multipart/form-data',
  })

  // Delete file or directory
  .delete('/', async ({ user, params, body, set }) => {
    const projectPath = await getSessionProject(params.id, user!.id, set);
    if (!projectPath) {
      return { error: set.status === 404 ? 'Session not found' : 'Session has no project' };
    }

    const requestedPath = (body as { path: string }).path;
    if (!requestedPath || requestedPath === '.' || requestedPath === '/') {
      set.status = 400;
      return { error: 'Cannot delete project root' };
    }

    const validatedPath = await validatePath(projectPath, requestedPath);
    if (!validatedPath) {
      set.status = 403;
      return { error: 'Path traversal not allowed' };
    }

    // Prevent deleting the project root itself
    const projectRoot = await realpath(resolve(projectPath));
    if (validatedPath === projectRoot) {
      set.status = 400;
      return { error: 'Cannot delete project root' };
    }

    try {
      const fileStat = await stat(validatedPath);
      if (fileStat.isDirectory()) {
        await rm(validatedPath, { recursive: true });
      } else {
        await unlink(validatedPath);
      }
      return { success: true };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        set.status = 404;
        return { error: 'Path not found' };
      }
      set.status = 500;
      return { error: 'Failed to delete' };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ path: t.String() }),
  })

  // Copy file or directory
  .post('/copy', async ({ user, params, body, set }) => {
    const projectPath = await getSessionProject(params.id, user!.id, set);
    if (!projectPath) {
      return { error: set.status === 404 ? 'Session not found' : 'Session has no project' };
    }

    const { source, destination } = body;
    const validatedSrc = await validatePath(projectPath, source);
    const validatedDest = await validatePath(projectPath, destination);
    if (!validatedSrc || !validatedDest) {
      set.status = 403;
      return { error: 'Path traversal not allowed' };
    }

    try {
      const srcStat = await stat(validatedSrc);
      await mkdir(dirname(validatedDest), { recursive: true });
      if (srcStat.isDirectory()) {
        await cp(validatedSrc, validatedDest, { recursive: true });
      } else {
        await copyFile(validatedSrc, validatedDest);
      }
      return { success: true };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        set.status = 404;
        return { error: 'Source not found' };
      }
      set.status = 500;
      return { error: 'Failed to copy' };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ source: t.String(), destination: t.String() }),
  })

  // Move / rename file or directory
  .post('/move', async ({ user, params, body, set }) => {
    const projectPath = await getSessionProject(params.id, user!.id, set);
    if (!projectPath) {
      return { error: set.status === 404 ? 'Session not found' : 'Session has no project' };
    }

    const { source, destination } = body;
    const validatedSrc = await validatePath(projectPath, source);
    const validatedDest = await validatePath(projectPath, destination);
    if (!validatedSrc || !validatedDest) {
      set.status = 403;
      return { error: 'Path traversal not allowed' };
    }

    try {
      await mkdir(dirname(validatedDest), { recursive: true });
      await rename(validatedSrc, validatedDest);
      return { success: true };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      // EXDEV = cross-device move; fall back to copy + delete
      if (err.code === 'EXDEV') {
        try {
          const srcStat = await stat(validatedSrc);
          if (srcStat.isDirectory()) {
            await cp(validatedSrc, validatedDest, { recursive: true });
            await rm(validatedSrc, { recursive: true });
          } else {
            await copyFile(validatedSrc, validatedDest);
            await unlink(validatedSrc);
          }
          return { success: true };
        } catch {
          set.status = 500;
          return { error: 'Failed to move' };
        }
      }
      if (err.code === 'ENOENT') {
        set.status = 404;
        return { error: 'Source not found' };
      }
      set.status = 500;
      return { error: 'Failed to move' };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ source: t.String(), destination: t.String() }),
  });
