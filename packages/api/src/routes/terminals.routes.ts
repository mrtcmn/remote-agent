import { Elysia, t } from 'elysia';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { db, claudeSessions, terminals } from '../db';
import { terminalService } from '../services/terminal';
import { workspaceService } from '../services/workspace';
import { requireAuth } from '../auth/middleware';

export const terminalRoutes = new Elysia({ prefix: '/terminals' })
  .use(requireAuth)

  // List terminals for a session
  .get('/session/:sessionId', async ({ user, params, set }) => {
    // Verify session ownership
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.sessionId),
        eq(claudeSessions.userId, user!.id)
      ),
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    // Get terminals from database
    const dbTerminals = await db.query.terminals.findMany({
      where: eq(terminals.sessionId, params.sessionId),
    });

    // Enrich with live status
    return dbTerminals.map(t => {
      const live = terminalService.getTerminal(t.id);
      return {
        ...t,
        command: JSON.parse(t.command),
        liveStatus: live?.status || t.status,
      };
    });
  }, {
    params: t.Object({
      sessionId: t.String(),
    }),
  })

  // Create terminal
  .post('/', async ({ user, body, set }) => {
    // Verify session ownership
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, body.sessionId),
        eq(claudeSessions.userId, user!.id)
      ),
      with: { project: true },
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    const terminalId = nanoid();
    const cwd = session.project?.localPath || `/app/workspaces/${user!.id}`;

    try {
      const terminal = await terminalService.createTerminal({
        terminalId,
        sessionId: body.sessionId,
        name: body.name,
        command: body.command || ['bash'],
        cols: body.cols,
        rows: body.rows,
        persist: body.persist,
        cwd,
        env: {
          HOME: process.env.HOME || '/root',
        },
      });

      return {
        id: terminal.id,
        sessionId: terminal.sessionId,
        name: terminal.name,
        command: terminal.command,
        cols: terminal.cols,
        rows: terminal.rows,
        persist: terminal.persist,
        status: terminal.status,
      };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    body: t.Object({
      sessionId: t.String(),
      name: t.Optional(t.String()),
      command: t.Optional(t.Array(t.String())),
      cols: t.Optional(t.Number()),
      rows: t.Optional(t.Number()),
      persist: t.Optional(t.Boolean()),
    }),
  })

  // Get terminal
  .get('/:id', async ({ user, params, set }) => {
    const terminal = await db.query.terminals.findFirst({
      where: eq(terminals.id, params.id),
      with: { session: true },
    });

    if (!terminal) {
      set.status = 404;
      return { error: 'Terminal not found' };
    }

    // Verify ownership via session
    if (terminal.session.userId !== user!.id) {
      set.status = 403;
      return { error: 'Forbidden' };
    }

    const live = terminalService.getTerminal(params.id);

    return {
      ...terminal,
      command: JSON.parse(terminal.command),
      liveStatus: live?.status || terminal.status,
    };
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // Resize terminal
  .post('/:id/resize', async ({ user, params, body, set }) => {
    const terminal = await db.query.terminals.findFirst({
      where: eq(terminals.id, params.id),
      with: { session: true },
    });

    if (!terminal) {
      set.status = 404;
      return { error: 'Terminal not found' };
    }

    if (terminal.session.userId !== user!.id) {
      set.status = 403;
      return { error: 'Forbidden' };
    }

    try {
      await terminalService.resize(params.id, body.cols, body.rows);
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
      cols: t.Number(),
      rows: t.Number(),
    }),
  })

  // Close terminal
  .delete('/:id', async ({ user, params, set }) => {
    const terminal = await db.query.terminals.findFirst({
      where: eq(terminals.id, params.id),
      with: { session: true },
    });

    if (!terminal) {
      set.status = 404;
      return { error: 'Terminal not found' };
    }

    if (terminal.session.userId !== user!.id) {
      set.status = 403;
      return { error: 'Forbidden' };
    }

    await terminalService.closeTerminal(params.id);

    return { success: true };
  }, {
    params: t.Object({
      id: t.String(),
    }),
  });
