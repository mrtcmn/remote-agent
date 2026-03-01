import { Elysia, t } from 'elysia';
import { eq, and } from 'drizzle-orm';
import { db, projects, runConfigs } from '../db';
import { runConfigService } from '../services/run-config';
import { NpmScriptAdapter } from '../services/spawn-adapter/npm-script.adapter';
import { requireAuth } from '../auth/middleware';

export const runConfigRoutes = new Elysia({ prefix: '/run-configs' })
  .use(requireAuth)

  // List run configs for a project
  .get('/project/:projectId', async ({ user, params, set }) => {
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

    return runConfigService.list(params.projectId);
  }, {
    params: t.Object({
      projectId: t.String(),
    }),
  })

  // Discover package.json scripts for a project
  .get('/project/:projectId/scripts', async ({ user, params, set }) => {
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

    const scripts = await NpmScriptAdapter.discoverScripts(project.localPath);
    return { scripts };
  }, {
    params: t.Object({
      projectId: t.String(),
    }),
  })

  // Create run config
  .post('/', async ({ user, body, set }) => {
    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.id, body.projectId),
        eq(projects.userId, user!.id),
      ),
    });

    if (!project) {
      set.status = 404;
      return { error: 'Project not found' };
    }

    try {
      const config = await runConfigService.create({
        projectId: body.projectId,
        userId: user!.id,
        name: body.name,
        adapterType: body.adapterType,
        command: body.command,
        cwd: body.cwd,
        env: body.env,
        autoRestart: body.autoRestart,
      });

      return config;
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    body: t.Object({
      projectId: t.String(),
      name: t.String(),
      adapterType: t.Union([
        t.Literal('npm_script'),
        t.Literal('custom_command'),
        t.Literal('browser_preview'),
      ]),
      command: t.Record(t.String(), t.Unknown()),
      cwd: t.Optional(t.String()),
      env: t.Optional(t.Record(t.String(), t.String())),
      autoRestart: t.Optional(t.Boolean()),
    }),
  })

  // Update run config
  .patch('/:id', async ({ user, params, body, set }) => {
    const config = await db.query.runConfigs.findFirst({
      where: eq(runConfigs.id, params.id),
    });

    if (!config) {
      set.status = 404;
      return { error: 'Run config not found' };
    }

    if (config.userId !== user!.id) {
      set.status = 403;
      return { error: 'Forbidden' };
    }

    try {
      const updated = await runConfigService.update(params.id, body);
      return updated;
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      name: t.Optional(t.String()),
      adapterType: t.Optional(t.Union([
        t.Literal('npm_script'),
        t.Literal('custom_command'),
        t.Literal('browser_preview'),
      ])),
      command: t.Optional(t.Record(t.String(), t.Unknown())),
      cwd: t.Optional(t.Union([t.String(), t.Null()])),
      env: t.Optional(t.Union([t.Record(t.String(), t.String()), t.Null()])),
      autoRestart: t.Optional(t.Boolean()),
      position: t.Optional(t.Number()),
    }),
  })

  // Delete run config
  .delete('/:id', async ({ user, params, set }) => {
    const config = await db.query.runConfigs.findFirst({
      where: eq(runConfigs.id, params.id),
    });

    if (!config) {
      set.status = 404;
      return { error: 'Run config not found' };
    }

    if (config.userId !== user!.id) {
      set.status = 403;
      return { error: 'Forbidden' };
    }

    await runConfigService.delete(params.id);
    return { success: true };
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // Start run config
  .post('/:id/start', async ({ user, params, body, set }) => {
    const config = await db.query.runConfigs.findFirst({
      where: eq(runConfigs.id, params.id),
    });

    if (!config) {
      set.status = 404;
      return { error: 'Run config not found' };
    }

    if (config.userId !== user!.id) {
      set.status = 403;
      return { error: 'Forbidden' };
    }

    try {
      const result = await runConfigService.start(params.id, body.sessionId);
      return { success: true, ...result };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      sessionId: t.String(),
    }),
  })

  // Stop run config
  .post('/:id/stop', async ({ user, params, set }) => {
    const config = await db.query.runConfigs.findFirst({
      where: eq(runConfigs.id, params.id),
    });

    if (!config) {
      set.status = 404;
      return { error: 'Run config not found' };
    }

    if (config.userId !== user!.id) {
      set.status = 403;
      return { error: 'Forbidden' };
    }

    await runConfigService.stop(params.id);
    return { success: true };
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // Restart run config
  .post('/:id/restart', async ({ user, params, body, set }) => {
    const config = await db.query.runConfigs.findFirst({
      where: eq(runConfigs.id, params.id),
    });

    if (!config) {
      set.status = 404;
      return { error: 'Run config not found' };
    }

    if (config.userId !== user!.id) {
      set.status = 403;
      return { error: 'Forbidden' };
    }

    try {
      const result = await runConfigService.restart(params.id, body.sessionId);
      return { success: true, ...result };
    } catch (error) {
      set.status = 500;
      return { error: (error as Error).message };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      sessionId: t.String(),
    }),
  });
