import { Elysia, t } from 'elysia';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { db, claudeSessions, projects } from '../db';
import { terminalService } from '../services/terminal';
import { gitService } from '../services/git';
import { notificationService } from '../services/notification';
import { requireAuth } from '../auth/middleware';

export const sessionRoutes = new Elysia({ prefix: '/sessions' })
  .use(requireAuth)

  // List user sessions
  .get('/', async ({ user }) => {
    const sessions = await db.query.claudeSessions.findMany({
      where: eq(claudeSessions.userId, user!.id),
      orderBy: (s, { desc }) => [desc(s.lastActiveAt)],
      with: {
        project: true,
      },
    });

    // Check if sessions have running terminals
    return sessions.map(session => {
      const terminals = terminalService.getSessionTerminals(session.id);
      const hasActiveTerminals = terminals.some(t => t.status === 'running');
      return {
        ...session,
        liveStatus: hasActiveTerminals ? 'active' : session.status,
      };
    });
  })

  // Get single session
  .get('/:id', async ({ user, params, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.id),
        eq(claudeSessions.userId, user!.id)
      ),
      with: {
        project: true,
      },
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    const terminals = terminalService.getSessionTerminals(session.id);
    const hasActiveTerminals = terminals.some(t => t.status === 'running');

    return {
      ...session,
      liveStatus: hasActiveTerminals ? 'active' : session.status,
    };
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // Create new session (container for terminals)
  .post('/', async ({ user, body, set }) => {
    const sessionId = nanoid();

    // Verify project if provided
    if (body.projectId) {
      const project = await db.query.projects.findFirst({
        where: and(
          eq(projects.id, body.projectId),
          eq(projects.userId, user!.id)
        ),
      });

      if (!project) {
        set.status = 404;
        return { error: 'Project not found' };
      }
    }

    // Create session record
    await db.insert(claudeSessions).values({
      id: sessionId,
      userId: user!.id,
      projectId: body.projectId || null,
      status: 'active',
      createdAt: new Date(),
      lastActiveAt: new Date(),
    });

    const session = await db.query.claudeSessions.findFirst({
      where: eq(claudeSessions.id, sessionId),
      with: { project: true },
    });

    return session;
  }, {
    body: t.Object({
      projectId: t.Optional(t.String()),
    }),
  })

  // Get git status for session's project
  .get('/:id/git/status', async ({ user, params, set }) => {
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
      return { branch: '', ahead: 0, behind: 0, staged: [], modified: [], untracked: [] };
    }

    try {
      const status = await gitService.status(session.project.localPath);
      return status;
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // Get git diff for session's project
  .get('/:id/git/diff', async ({ user, params, query, set }) => {
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
      return { diff: '' };
    }

    try {
      const diff = await gitService.diff(session.project.localPath, query.cached === 'true');
      return { diff };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
    query: t.Object({
      cached: t.Optional(t.String()),
    }),
  })

  // Get diff for a specific file
  .get('/:id/git/diff/:file', async ({ user, params, set }) => {
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
      return { diff: '' };
    }

    try {
      // Use git diff for specific file
      const { $ } = await import('bun');
      const filePath = decodeURIComponent(params.file);
      const result = await $`git diff -- ${filePath}`.cwd(session.project.localPath).quiet();
      return { diff: result.stdout.toString(), file: filePath };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({
      id: t.String(),
      file: t.String(),
    }),
  })

  // Terminate session (close all terminals)
  .delete('/:id', async ({ user, params, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.id),
        eq(claudeSessions.userId, user!.id)
      ),
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    // Close all terminals for this session
    await terminalService.closeSessionTerminals(params.id);

    // Dismiss pending notifications for this session
    await notificationService.dismissBySession(params.id);

    // Delete session (cascades to messages, terminals, review comments)
    await db.delete(claudeSessions)
      .where(eq(claudeSessions.id, params.id));

    return { success: true };
  }, {
    params: t.Object({
      id: t.String(),
    }),
  });
