import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import {
  db,
  runFlows,
  runFlowNodes,
  runFlowEdges,
  runConfigs,
} from '../../db';
import type { RunFlowNode, RunFlowEdge } from '../../db';
import { runConfigService } from '../run-config';
import { terminalService } from '../terminal';

interface NodeInput {
  id?: string;
  runConfigId: string;
  x: number;
  y: number;
}

interface EdgeInput {
  id?: string;
  sourceNodeId: string;
  targetNodeId: string;
  readyDelayMs?: number;
}

interface NodeStatus {
  nodeId: string;
  runConfigId: string;
  isRunning: boolean;
  activeTerminalId: string | null;
}

export class RunFlowService extends EventEmitter {
  async list(projectId: string) {
    return db.query.runFlows.findMany({
      where: eq(runFlows.projectId, projectId),
    });
  }

  async get(id: string) {
    const flow = await db.query.runFlows.findFirst({
      where: eq(runFlows.id, id),
      with: {
        nodes: { with: { runConfig: true } },
        edges: true,
      },
    });
    if (!flow) return null;
    return {
      ...flow,
      viewport: flow.viewport ? JSON.parse(flow.viewport) : null,
    };
  }

  // Ensure at least one flow exists for the project; returns the default flow.
  async getOrCreateDefault(projectId: string, userId: string) {
    const existing = await db.query.runFlows.findFirst({
      where: eq(runFlows.projectId, projectId),
    });
    if (existing) return this.get(existing.id);
    return this.create({ projectId, userId, name: 'Default' });
  }

  async create(data: { projectId: string; userId: string; name: string }) {
    const id = nanoid();
    await db.insert(runFlows).values({
      id,
      projectId: data.projectId,
      userId: data.userId,
      name: data.name,
    });
    return this.get(id);
  }

  async update(
    id: string,
    data: {
      name?: string;
      viewport?: { x: number; y: number; zoom: number } | null;
      nodes?: NodeInput[];
      edges?: EdgeInput[];
    },
  ) {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.viewport !== undefined) {
      patch.viewport = data.viewport ? JSON.stringify(data.viewport) : null;
    }

    if (Object.keys(patch).length > 1) {
      await db.update(runFlows).set(patch).where(eq(runFlows.id, id));
    }

    if (data.nodes) {
      await this.replaceNodes(id, data.nodes);
    }
    if (data.edges) {
      await this.replaceEdges(id, data.edges);
    }

    return this.get(id);
  }

  private async replaceNodes(flowId: string, nodes: NodeInput[]) {
    const existing: RunFlowNode[] = await db.query.runFlowNodes.findMany({
      where: eq(runFlowNodes.flowId, flowId),
    });
    const existingById = new Map(existing.map((n: RunFlowNode) => [n.id, n]));
    const incomingIds = new Set(nodes.map((n) => n.id).filter(Boolean) as string[]);

    // Delete removed nodes
    for (const node of existing) {
      if (!incomingIds.has(node.id)) {
        await db.delete(runFlowNodes).where(eq(runFlowNodes.id, node.id));
      }
    }

    // Upsert
    for (const node of nodes) {
      if (node.id && existingById.has(node.id)) {
        await db
          .update(runFlowNodes)
          .set({
            runConfigId: node.runConfigId,
            x: Math.round(node.x),
            y: Math.round(node.y),
          })
          .where(eq(runFlowNodes.id, node.id));
      } else {
        await db.insert(runFlowNodes).values({
          id: node.id || nanoid(),
          flowId,
          runConfigId: node.runConfigId,
          x: Math.round(node.x),
          y: Math.round(node.y),
        });
      }
    }
  }

  private async replaceEdges(flowId: string, edges: EdgeInput[]) {
    const existing: RunFlowEdge[] = await db.query.runFlowEdges.findMany({
      where: eq(runFlowEdges.flowId, flowId),
    });
    const existingById = new Map(existing.map((e: RunFlowEdge) => [e.id, e]));
    const incomingIds = new Set(edges.map((e) => e.id).filter(Boolean) as string[]);

    for (const edge of existing) {
      if (!incomingIds.has(edge.id)) {
        await db.delete(runFlowEdges).where(eq(runFlowEdges.id, edge.id));
      }
    }

    for (const edge of edges) {
      if (edge.id && existingById.has(edge.id)) {
        await db
          .update(runFlowEdges)
          .set({
            sourceNodeId: edge.sourceNodeId,
            targetNodeId: edge.targetNodeId,
            readyDelayMs: edge.readyDelayMs ?? 1000,
          })
          .where(eq(runFlowEdges.id, edge.id));
      } else {
        await db.insert(runFlowEdges).values({
          id: edge.id || nanoid(),
          flowId,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          readyDelayMs: edge.readyDelayMs ?? 1000,
        });
      }
    }
  }

  async delete(id: string) {
    await db.delete(runFlows).where(eq(runFlows.id, id));
    this.emit('deleted', id);
  }

  // Phase 1: start every node in parallel (edges are decorative only).
  // Phase 2 will implement topo-sort + readyDelayMs gating.
  async runAll(flowId: string, sessionId: string) {
    const flow = await this.get(flowId);
    if (!flow) throw new Error('Flow not found');

    const results: Array<{ nodeId: string; terminalId: string }> = [];
    for (const node of flow.nodes) {
      try {
        const result = await runConfigService.start(node.runConfigId, sessionId);
        results.push({ nodeId: node.id, terminalId: result.terminalId });
      } catch (err) {
        this.emit('node-start-failed', {
          flowId,
          nodeId: node.id,
          error: (err as Error).message,
        });
      }
    }

    this.emit('started', { flowId, started: results.length });
    return { started: results };
  }

  // Start the given node plus every node reachable via outgoing edges
  // (transitive downstream). Phase 1: parallel start; Phase 2 will respect
  // edge readyDelayMs.
  async runFromNode(flowId: string, nodeId: string, sessionId: string) {
    const flow = await this.get(flowId);
    if (!flow) throw new Error('Flow not found');

    const nodes: Array<{ id: string; runConfigId: string }> = flow.nodes;
    const startNode = nodes.find((n) => n.id === nodeId);
    if (!startNode) throw new Error('Node not found in flow');

    // BFS downstream
    const adjacency = new Map<string, string[]>();
    for (const edge of flow.edges) {
      const list = adjacency.get(edge.sourceNodeId) ?? [];
      list.push(edge.targetNodeId);
      adjacency.set(edge.sourceNodeId, list);
    }

    const visited = new Set<string>();
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) queue.push(next);
      }
    }

    const nodesById = new Map(nodes.map((n) => [n.id, n] as const));
    const results: Array<{ nodeId: string; terminalId: string }> = [];
    for (const id of visited) {
      const node = nodesById.get(id);
      if (!node) continue;
      try {
        const result = await runConfigService.start(node.runConfigId, sessionId);
        results.push({ nodeId: id, terminalId: result.terminalId });
      } catch (err) {
        this.emit('node-start-failed', {
          flowId,
          nodeId: id,
          error: (err as Error).message,
        });
      }
    }

    this.emit('subflow-started', { flowId, fromNodeId: nodeId, started: results.length });
    return { started: results };
  }

  async stopAll(flowId: string) {
    const flow = await this.get(flowId);
    if (!flow) throw new Error('Flow not found');

    for (const node of flow.nodes) {
      try {
        await runConfigService.stop(node.runConfigId);
      } catch {
        // Ignore — node may not be running.
      }
    }

    this.emit('stopped', { flowId });
  }

  async getStatus(flowId: string): Promise<NodeStatus[]> {
    const nodes = await db.query.runFlowNodes.findMany({
      where: eq(runFlowNodes.flowId, flowId),
      with: { runConfig: { with: { instances: true } } },
    });

    return (nodes as Array<RunFlowNode & { runConfig: { instances: Array<{ stoppedAt: Date | null; terminalId: string | null }> } | null }>).map((node) => {
      const instances = node.runConfig?.instances || [];
      const running = instances.filter((inst) => !inst.stoppedAt);
      const active = running.find((inst) => {
        if (!inst.terminalId) return false;
        const terminal = terminalService.getTerminal(inst.terminalId);
        return terminal?.status === 'running';
      });
      return {
        nodeId: node.id,
        runConfigId: node.runConfigId,
        isRunning: !!active,
        activeTerminalId: active?.terminalId || null,
      };
    });
  }

  // Validate that a node's runConfig belongs to the flow's project
  // (or one of its child links if the flow project is multi-project).
  async validateNodeRunConfig(flowProjectId: string, runConfigId: string) {
    const config = await db.query.runConfigs.findFirst({
      where: eq(runConfigs.id, runConfigId),
      with: { project: true },
    });
    if (!config) return false;
    if (config.projectId === flowProjectId) return true;

    // Check if config's project is a child link of the flow's parent project.
    const { projectLinks } = await import('../../db');
    const link = await db.query.projectLinks.findFirst({
      where: and(
        eq(projectLinks.parentProjectId, flowProjectId),
        eq(projectLinks.childProjectId, config.projectId),
      ),
    });
    return !!link;
  }
}

export const runFlowService = new RunFlowService();
