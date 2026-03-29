import { Elysia, t } from 'elysia';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, projects, worktrees, claudeSessions } from '../db';
import { worktreeService } from '../services/git/worktree.service';
import { requireAuth } from '../auth/middleware';

export const worktreeRoutes = new Elysia({ prefix: '/worktrees' })
  .use(requireAuth)

  // List worktrees for a project
  .get('/project/:projectId', async ({ user, params, set }) => {
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, params.projectId), eq(projects.userId, user!.id)),
    });
    if (!project) {
      set.status = 404;
      return { error: 'Project not found' };
    }
    return worktreeService.list(params.projectId);
  }, {
    params: t.Object({ projectId: t.String() }),
  })

  // Create worktree + session
  .post('/', async ({ user, body, set }) => {
    try {
      // Create the worktree on disk + DB
      const worktree = await worktreeService.create({
        projectId: body.projectId,
        userId: user!.id,
        branch: body.branch,
        name: body.name,
        createBranch: body.createBranch,
      });

      // Create a session bound to this worktree
      const sessionId = nanoid();
      await db.insert(claudeSessions).values({
        id: sessionId,
        userId: user!.id,
        projectId: body.projectId,
        worktreeId: worktree.id,
        status: 'active',
        createdAt: new Date(),
        lastActiveAt: new Date(),
      });

      const session = await db.query.claudeSessions.findFirst({
        where: eq(claudeSessions.id, sessionId),
        with: { project: true, worktree: true },
      });

      return { worktree, session };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    body: t.Object({
      projectId: t.String(),
      branch: t.String(),
      name: t.String(),
      createBranch: t.Optional(t.Boolean()),
    }),
  })

  // Delete worktree
  .delete('/:id', async ({ user, params, set }) => {
    try {
      await worktreeService.remove(params.id, user!.id);
      return { success: true };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({ id: t.String() }),
  });
