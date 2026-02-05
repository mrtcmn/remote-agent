import { Elysia, t } from 'elysia';
import { eq, and } from 'drizzle-orm';
import { db, claudeSessions } from '../db';
import { requireAuth } from '../auth/middleware';
import { readdir, stat, readFile, realpath } from 'fs/promises';
import { join, resolve, basename } from 'path';

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

export const fileRoutes = new Elysia({ prefix: '/sessions/:id/files' })
  .use(requireAuth)

  // List directory contents
  .get('/', async ({ user, params, query, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.id),
        eq(claudeSessions.userId, user!.id)
      ),
      with: { project: true },
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    if (!session.project) {
      set.status = 400;
      return { error: 'Session has no project' };
    }

    const projectPath = session.project.localPath;
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
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.id),
        eq(claudeSessions.userId, user!.id)
      ),
      with: { project: true },
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    if (!session.project) {
      set.status = 400;
      return { error: 'Session has no project' };
    }

    const projectPath = session.project.localPath;
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
  });
