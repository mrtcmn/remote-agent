import { eq, and, asc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, kanbanAutoFlows, kanbanFlowSteps, kanbanTasks, kanbanTaskDependencies, projects } from '../../db';
import type { ExecutionStrategy, FlowExecutionContext } from './types';
import { AutoCLIStrategy } from './strategies/auto-cli.strategy';
import { ManualStrategy } from './strategies/manual.strategy';

class AutoFlowService {
  private strategies: ExecutionStrategy[] = [];
  private runningFlows = new Map<string, boolean>();

  constructor() {
    // Register default strategies
    this.strategies.push(new AutoCLIStrategy());
    this.strategies.push(new ManualStrategy());
  }

  registerStrategy(strategy: ExecutionStrategy): void {
    this.strategies.push(strategy);
  }

  // ─── Flow CRUD ──────────────────────────────────────────────────────────

  async getFlows(userId: string, projectId?: string) {
    const conditions = [eq(kanbanAutoFlows.userId, userId)];
    if (projectId) conditions.push(eq(kanbanAutoFlows.projectId, projectId));

    return db.query.kanbanAutoFlows.findMany({
      where: and(...conditions),
      with: {
        steps: {
          with: { task: true },
          orderBy: [asc(kanbanFlowSteps.stepOrder)],
        },
        project: true,
      },
      orderBy: [asc(kanbanAutoFlows.createdAt)],
    });
  }

  async getFlow(flowId: string, userId: string) {
    return db.query.kanbanAutoFlows.findFirst({
      where: and(eq(kanbanAutoFlows.id, flowId), eq(kanbanAutoFlows.userId, userId)),
      with: {
        steps: {
          with: { task: true, session: true },
          orderBy: [asc(kanbanFlowSteps.stepOrder)],
        },
        project: true,
      },
    });
  }

  async createFlow(userId: string, data: {
    projectId: string;
    name: string;
    description?: string;
    triggerType?: string;
    cronExpression?: string;
    adapterType?: string;
    adapterConfig?: Record<string, any>;
    taskIds?: string[];
  }) {
    const flowId = nanoid();

    await db.insert(kanbanAutoFlows).values({
      id: flowId,
      projectId: data.projectId,
      userId,
      name: data.name,
      description: data.description || null,
      triggerType: (data.triggerType || 'on_complete') as any,
      cronExpression: data.cronExpression || null,
      adapterType: (data.adapterType || 'claude_code') as any,
      adapterConfig: data.adapterConfig ? JSON.stringify(data.adapterConfig) : null,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Add steps if task IDs provided
    if (data.taskIds?.length) {
      for (let i = 0; i < data.taskIds.length; i++) {
        await db.insert(kanbanFlowSteps).values({
          id: nanoid(),
          flowId,
          taskId: data.taskIds[i],
          stepOrder: i + 1,
          adapterType: (data.adapterType || 'claude_code') as any,
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }

    return this.getFlow(flowId, userId);
  }

  async updateFlow(flowId: string, userId: string, data: Partial<{
    name: string;
    description: string;
    triggerType: string;
    cronExpression: string;
    adapterType: string;
    adapterConfig: Record<string, any>;
    enabled: boolean;
  }>) {
    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.triggerType !== undefined) updateData.triggerType = data.triggerType;
    if (data.cronExpression !== undefined) updateData.cronExpression = data.cronExpression;
    if (data.adapterType !== undefined) updateData.adapterType = data.adapterType;
    if (data.adapterConfig !== undefined) updateData.adapterConfig = JSON.stringify(data.adapterConfig);
    if (data.enabled !== undefined) updateData.enabled = data.enabled;

    await db.update(kanbanAutoFlows)
      .set(updateData)
      .where(and(eq(kanbanAutoFlows.id, flowId), eq(kanbanAutoFlows.userId, userId)));

    return this.getFlow(flowId, userId);
  }

  async deleteFlow(flowId: string, userId: string) {
    await db.delete(kanbanAutoFlows)
      .where(and(eq(kanbanAutoFlows.id, flowId), eq(kanbanAutoFlows.userId, userId)));
    return { success: true };
  }

  // ─── Flow Execution ─────────────────────────────────────────────────────

  async onTaskCompleted(taskId: string, userId: string): Promise<void> {
    // Find tasks that depend on this completed task and have autoFlow enabled
    const dependents = await db.query.kanbanTaskDependencies.findMany({
      where: eq(kanbanTaskDependencies.dependsOnTaskId, taskId),
      with: { task: true },
    });

    for (const dep of dependents) {
      const task = dep.task as any;
      if (!task || !task.autoFlow) continue;

      // Check if ALL dependencies of this dependent task are completed
      const allDeps = await db.query.kanbanTaskDependencies.findMany({
        where: eq(kanbanTaskDependencies.taskId, task.id),
        with: { dependsOn: true },
      });

      const allCompleted = allDeps.every(d => (d.dependsOn as any)?.status === 'completed');
      if (!allCompleted) continue;

      // All dependencies met - move task to in_progress and execute
      console.log(`[auto-flow] All dependencies met for task ${task.id}, starting auto-execution`);

      await db.update(kanbanTasks)
        .set({
          status: 'in_progress',
          assigneeType: 'agent',
          updatedAt: new Date(),
        })
        .where(eq(kanbanTasks.id, task.id));

      // Get project path
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, task.projectId),
      });

      if (!project) continue;

      const context: FlowExecutionContext = {
        flowId: task.id,
        taskId: task.id,
        projectPath: project.localPath,
        branch: task.branch || undefined,
        adapterType: task.adapterType || 'claude_code',
        adapterConfig: task.adapterConfig ? JSON.parse(task.adapterConfig) : undefined,
        prompt: task.description || task.title,
      };

      // Find appropriate strategy and execute (non-blocking)
      this.executeWithStrategy(context, task.id, userId).catch(err => {
        console.error(`[auto-flow] Error executing task ${task.id}:`, err);
      });
    }
  }

  private async executeWithStrategy(context: FlowExecutionContext, taskId: string, userId: string): Promise<void> {
    const strategy = this.strategies.find(s => s.canHandle(context));
    if (!strategy) {
      console.error(`[auto-flow] No strategy found for context:`, context);
      return;
    }

    this.runningFlows.set(taskId, true);

    try {
      const result = await strategy.execute(context);

      if (result.success) {
        // Move task to review_needed after successful execution
        await db.update(kanbanTasks)
          .set({
            status: 'review_needed',
            updatedAt: new Date(),
          })
          .where(eq(kanbanTasks.id, taskId));

        console.log(`[auto-flow] Task ${taskId} completed successfully, moved to review_needed`);
      } else {
        // Keep in_progress but log the error
        console.error(`[auto-flow] Task ${taskId} execution failed:`, result.error);
      }
    } finally {
      this.runningFlows.delete(taskId);
    }
  }

  isRunning(taskId: string): boolean {
    return this.runningFlows.has(taskId);
  }

  // ─── Flow Step Management ───────────────────────────────────────────────

  async addFlowStep(flowId: string, taskId: string, adapterType?: string) {
    // Get max step order
    const steps = await db.query.kanbanFlowSteps.findMany({
      where: eq(kanbanFlowSteps.flowId, flowId),
      orderBy: [asc(kanbanFlowSteps.stepOrder)],
    });
    const maxOrder = steps.length > 0 ? Math.max(...steps.map(s => s.stepOrder)) : 0;

    const id = nanoid();
    await db.insert(kanbanFlowSteps).values({
      id,
      flowId,
      taskId,
      stepOrder: maxOrder + 1,
      adapterType: (adapterType || 'claude_code') as any,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return db.query.kanbanFlowSteps.findFirst({
      where: eq(kanbanFlowSteps.id, id),
      with: { task: true },
    });
  }

  async removeFlowStep(stepId: string) {
    await db.delete(kanbanFlowSteps).where(eq(kanbanFlowSteps.id, stepId));
    return { success: true };
  }
}

export const autoFlowService = new AutoFlowService();
