import { Elysia, t } from 'elysia';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { db, claudeSessions, codeEditors } from '../db';
import { codeEditorService } from '../services/code-editor';
import { requireAuth } from '../auth/middleware';

export const editorRoutes = new Elysia({ prefix: '/sessions' })
  .use(requireAuth)

  // Get editor status for a session
  .get('/:id/editor', async ({ user, params, set }) => {
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

    // Check in-memory first
    const live = codeEditorService.getEditorBySession(params.id);
    if (live) {
      return {
        id: live.id,
        sessionId: live.sessionId,
        port: live.port,
        status: live.status,
        createdAt: live.createdAt.toISOString(),
      };
    }

    // Check DB for stopped editors
    const dbEditor = await db.query.codeEditors.findFirst({
      where: eq(codeEditors.sessionId, params.id),
    });

    if (!dbEditor) {
      return { status: 'none' as const };
    }

    return {
      id: dbEditor.id,
      sessionId: dbEditor.sessionId,
      port: dbEditor.port,
      status: dbEditor.status,
      createdAt: dbEditor.createdAt?.toISOString(),
      stoppedAt: dbEditor.stoppedAt?.toISOString(),
    };
  }, {
    params: t.Object({ id: t.String() }),
  })

  // Start editor for a session
  .post('/:id/editor', async ({ user, params, set }) => {
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

    const userWorkspace = `/app/workspaces/${user!.id}`;
    const projectPath = session.project?.localPath || userWorkspace;

    try {
      const editor = await codeEditorService.startEditor({
        editorId: nanoid(),
        sessionId: params.id,
        projectPath,
      });

      return {
        id: editor.id,
        sessionId: editor.sessionId,
        port: editor.port,
        status: editor.status,
        createdAt: editor.createdAt.toISOString(),
      };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({ id: t.String() }),
  })

  // Stop editor for a session
  .delete('/:id/editor', async ({ user, params, set }) => {
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

    await codeEditorService.stopSessionEditor(params.id);
    return { success: true };
  }, {
    params: t.Object({ id: t.String() }),
  });
