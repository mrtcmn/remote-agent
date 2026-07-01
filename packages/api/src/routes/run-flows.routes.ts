import { Elysia, t } from 'elysia';
import { eq, and } from 'drizzle-orm';
import { db, projects, runFlows } from '../db';
import { runFlowService } from '../services/run-flow';
import { requireAuth } from '../auth/middleware';

async function ensureFlowOwnership(flowId: string, userId: string) {
  const flow = await db.query.runFlows.findFirst({
    where: eq(runFlows.id, flowId),
  });
  if (!flow) return { ok: false as const, status: 404, error: 'Flow not found' };
  if (flow.userId !== userId) return { ok: false as const, status: 403, error: 'Forbidden' };
  return { ok: true as const, flow };
}

export const runFlowRoutes = new Elysia({ prefix: '/run-flows' })
  .use(requireAuth)

  // List flows for a project (auto-creates a Default flow on first call).
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

    const existing = await runFlowService.list(params.projectId);
    if (existing.length === 0) {
      await runFlowService.getOrCreateDefault(params.projectId, user!.id);
      return runFlowService.list(params.projectId);
    }
    return existing;
  }, {
    params: t.Object({ projectId: t.String() }),
  })

  // Get one flow (with nodes + edges)
  .get('/:id', async ({ user, params, set }) => {
    const check = await ensureFlowOwnership(params.id, user!.id);
    if (!check.ok) {
      set.status = check.status;
      return { error: check.error };
    }
    return runFlowService.get(params.id);
  }, {
    params: t.Object({ id: t.String() }),
  })

  // Create a flow
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
    return runFlowService.create({
      projectId: body.projectId,
      userId: user!.id,
      name: body.name,
    });
  }, {
    body: t.Object({
      projectId: t.String(),
      name: t.String(),
    }),
  })

  // Update a flow (name / viewport / nodes / edges in one shot)
  .patch('/:id', async ({ user, params, body, set }) => {
    const check = await ensureFlowOwnership(params.id, user!.id);
    if (!check.ok) {
      set.status = check.status;
      return { error: check.error };
    }

    // Validate node runConfig ownership
    if (body.nodes) {
      for (const node of body.nodes) {
        const valid = await runFlowService.validateNodeRunConfig(
          check.flow.projectId,
          node.runConfigId,
        );
        if (!valid) {
          set.status = 400;
          return { error: `Run config ${node.runConfigId} is not allowed in this flow` };
        }
      }
    }

    return runFlowService.update(params.id, body);
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      name: t.Optional(t.String()),
      viewport: t.Optional(t.Union([
        t.Object({ x: t.Number(), y: t.Number(), zoom: t.Number() }),
        t.Null(),
      ])),
      nodes: t.Optional(t.Array(t.Object({
        id: t.Optional(t.String()),
        runConfigId: t.String(),
        x: t.Number(),
        y: t.Number(),
      }))),
      edges: t.Optional(t.Array(t.Object({
        id: t.Optional(t.String()),
        sourceNodeId: t.String(),
        targetNodeId: t.String(),
        readyDelayMs: t.Optional(t.Number()),
      }))),
    }),
  })

  // Delete a flow
  .delete('/:id', async ({ user, params, set }) => {
    const check = await ensureFlowOwnership(params.id, user!.id);
    if (!check.ok) {
      set.status = check.status;
      return { error: check.error };
    }
    await runFlowService.delete(params.id);
    return { success: true };
  }, {
    params: t.Object({ id: t.String() }),
  })

  // Run every node in the flow
  .post('/:id/run', async ({ user, params, body, set }) => {
    const check = await ensureFlowOwnership(params.id, user!.id);
    if (!check.ok) {
      set.status = check.status;
      return { error: check.error };
    }
    try {
      const result = await runFlowService.runAll(params.id, body.sessionId);
      return { success: true, ...result };
    } catch (err) {
      set.status = 500;
      return { error: (err as Error).message };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ sessionId: t.String() }),
  })

  // Run a single node plus every node reachable downstream from it
  .post('/:id/nodes/:nodeId/run', async ({ user, params, body, set }) => {
    const check = await ensureFlowOwnership(params.id, user!.id);
    if (!check.ok) {
      set.status = check.status;
      return { error: check.error };
    }
    try {
      const result = await runFlowService.runFromNode(
        params.id,
        params.nodeId,
        body.sessionId,
      );
      return { success: true, ...result };
    } catch (err) {
      set.status = 500;
      return { error: (err as Error).message };
    }
  }, {
    params: t.Object({ id: t.String(), nodeId: t.String() }),
    body: t.Object({ sessionId: t.String() }),
  })

  // Stop every node in the flow
  .post('/:id/stop', async ({ user, params, set }) => {
    const check = await ensureFlowOwnership(params.id, user!.id);
    if (!check.ok) {
      set.status = check.status;
      return { error: check.error };
    }
    await runFlowService.stopAll(params.id);
    return { success: true };
  }, {
    params: t.Object({ id: t.String() }),
  })

  // Per-node running status (polled by the UI)
  .get('/:id/status', async ({ user, params, set }) => {
    const check = await ensureFlowOwnership(params.id, user!.id);
    if (!check.ok) {
      set.status = check.status;
      return { error: check.error };
    }
    return runFlowService.getStatus(params.id);
  }, {
    params: t.Object({ id: t.String() }),
  });
