import { Elysia, t } from 'elysia';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { db, claudeSessions, projects } from '../db';
import { claudeService } from '../services/claude';
import { workspaceService } from '../services/workspace';
import { terminalService } from '../services/terminal';
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

    // Enrich with live status
    return sessions.map(session => ({
      ...session,
      liveStatus: claudeService.getSession(session.id)?.status || session.status,
    }));
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

    const liveSession = claudeService.getSession(session.id);

    return {
      ...session,
      liveStatus: liveSession?.status || session.status,
    };
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // Create new session
  .post('/', async ({ user, body, set }) => {
    const sessionId = nanoid();

    // Get project path
    let projectPath: string;

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

      projectPath = project.localPath;
    } else {
      // Use user's workspace root
      projectPath = await workspaceService.createUserWorkspace(user!.id);
    }

    try {
      const session = await claudeService.createSession({
        sessionId,
        userId: user!.id,
        projectPath,
        skills: body.skills,
        resume: body.resumeSessionId,
        model: body.model,
      });

      // Update database with project association
      if (body.projectId) {
        await db.update(claudeSessions)
          .set({ projectId: body.projectId })
          .where(eq(claudeSessions.id, sessionId));
      }

      return {
        id: session.id,
        status: session.status,
        projectPath: session.projectPath,
      };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    body: t.Object({
      projectId: t.Optional(t.String()),
      skills: t.Optional(t.Array(t.String())),
      resumeSessionId: t.Optional(t.String()),
      model: t.Optional(t.String()),
    }),
  })

  // Send message to session
  .post('/:id/message', async ({ user, params, body, set }) => {
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

    try {
      await claudeService.sendMessage(params.id, body.message);
      return { success: true };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      message: t.String(),
    }),
  })

  // Resume session
  .post('/:id/resume', async ({ user, params, set }) => {
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

    if (!session.claudeSessionId) {
      set.status = 400;
      return { error: 'Session has no Claude session ID to resume' };
    }

    const project = session.projectId
      ? await db.query.projects.findFirst({
          where: eq(projects.id, session.projectId),
        })
      : null;

    try {
      const newSession = await claudeService.createSession({
        sessionId: nanoid(),
        userId: user!.id,
        projectPath: project?.localPath || `/app/workspaces/${user!.id}`,
        resume: session.claudeSessionId,
      });

      return {
        id: newSession.id,
        status: newSession.status,
        resumedFrom: params.id,
      };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // Terminate session
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

    // Close all terminals for this session first
    await terminalService.closeSessionTerminals(params.id);

    await claudeService.terminateSession(params.id);

    return { success: true };
  }, {
    params: t.Object({
      id: t.String(),
    }),
  });
