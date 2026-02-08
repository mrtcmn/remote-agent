import { eq, and, desc, asc, inArray, like, sql, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, kanbanTasks, kanbanTaskComments, kanbanTaskAttachments, kanbanTaskDependencies, projects, user } from '../../db';
import type { KanbanTask, NewKanbanTask, KanbanTaskComment, NewKanbanTaskComment } from '../../db';

export interface TaskFilters {
  projectId?: string;
  status?: string | string[];
  priority?: string | string[];
  assigneeType?: string;
  assigneeId?: string;
  sessionId?: string;
  parentTaskId?: string | null; // null = top-level only
  search?: string;
  labels?: string[];
}

export interface TaskListOptions {
  filters?: TaskFilters;
  orderBy?: 'position' | 'priority' | 'createdAt' | 'updatedAt';
  orderDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

class KanbanRepository {
  // ─── Tasks ──────────────────────────────────────────────────────────────

  async findTasks(userId: string, options: TaskListOptions = {}) {
    const { filters = {}, limit = 100, offset = 0 } = options;

    const conditions = [eq(kanbanTasks.userId, userId)];

    if (filters.projectId) {
      conditions.push(eq(kanbanTasks.projectId, filters.projectId));
    }
    if (filters.status) {
      if (Array.isArray(filters.status)) {
        conditions.push(inArray(kanbanTasks.status, filters.status as any));
      } else {
        conditions.push(eq(kanbanTasks.status, filters.status as any));
      }
    }
    if (filters.priority) {
      if (Array.isArray(filters.priority)) {
        conditions.push(inArray(kanbanTasks.priority, filters.priority as any));
      } else {
        conditions.push(eq(kanbanTasks.priority, filters.priority as any));
      }
    }
    if (filters.assigneeType) {
      conditions.push(eq(kanbanTasks.assigneeType, filters.assigneeType as any));
    }
    if (filters.assigneeId) {
      conditions.push(eq(kanbanTasks.assigneeId, filters.assigneeId));
    }
    if (filters.sessionId) {
      conditions.push(eq(kanbanTasks.sessionId, filters.sessionId));
    }
    if (filters.parentTaskId !== undefined) {
      if (filters.parentTaskId === null) {
        conditions.push(isNull(kanbanTasks.parentTaskId));
      } else {
        conditions.push(eq(kanbanTasks.parentTaskId, filters.parentTaskId));
      }
    }
    if (filters.search) {
      conditions.push(like(kanbanTasks.title, `%${filters.search}%`));
    }

    return db.query.kanbanTasks.findMany({
      where: and(...conditions),
      orderBy: [asc(kanbanTasks.position), desc(kanbanTasks.createdAt)],
      limit,
      offset,
      with: {
        project: true,
        subtasks: true,
        comments: { limit: 3, orderBy: [desc(kanbanTaskComments.createdAt)] },
        attachments: true,
        dependencies: { with: { dependsOn: true } },
      },
    });
  }

  async findTaskById(taskId: string, userId: string) {
    return db.query.kanbanTasks.findFirst({
      where: and(eq(kanbanTasks.id, taskId), eq(kanbanTasks.userId, userId)),
      with: {
        project: true,
        subtasks: {
          with: { comments: true, attachments: true },
          orderBy: [asc(kanbanTasks.position)],
        },
        comments: {
          with: {
            user: true,
            replies: { with: { user: true } },
            attachments: true,
          },
          where: isNull(kanbanTaskComments.parentCommentId),
          orderBy: [asc(kanbanTaskComments.createdAt)],
        },
        attachments: true,
        dependencies: { with: { dependsOn: true } },
        dependents: { with: { task: true } },
        session: true,
      },
    });
  }

  async createTask(data: {
    projectId: string;
    userId: string;
    title: string;
    description?: string;
    status?: string;
    priority?: string;
    parentTaskId?: string;
    assigneeType?: string;
    assigneeId?: string;
    autoFlow?: boolean;
    adapterType?: string;
    adapterConfig?: string;
    labels?: string;
    branch?: string;
    githubIssueNumber?: number;
    githubIssueUrl?: string;
  }) {
    const id = nanoid();

    // Get max position for this project+status
    const maxPos = await db.select({ max: sql<number>`coalesce(max(${kanbanTasks.position}), 0)` })
      .from(kanbanTasks)
      .where(and(
        eq(kanbanTasks.projectId, data.projectId),
        eq(kanbanTasks.status, (data.status || 'backlog') as any),
      ));

    const position = (maxPos[0]?.max || 0) + 1;

    await db.insert(kanbanTasks).values({
      id,
      projectId: data.projectId,
      userId: data.userId,
      parentTaskId: data.parentTaskId || null,
      title: data.title,
      description: data.description || null,
      status: (data.status || 'backlog') as any,
      priority: (data.priority || 'medium') as any,
      position,
      assigneeType: (data.assigneeType || 'unassigned') as any,
      assigneeId: data.assigneeId || null,
      autoFlow: data.autoFlow || false,
      adapterType: (data.adapterType || 'claude_code') as any,
      adapterConfig: data.adapterConfig || null,
      labels: data.labels || null,
      branch: data.branch || null,
      githubIssueNumber: data.githubIssueNumber || null,
      githubIssueUrl: data.githubIssueUrl || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return this.findTaskById(id, data.userId);
  }

  async updateTask(taskId: string, userId: string, data: Partial<{
    title: string;
    description: string;
    status: string;
    priority: string;
    position: number;
    parentTaskId: string | null;
    assigneeType: string;
    assigneeId: string | null;
    sessionId: string | null;
    autoFlow: boolean;
    adapterType: string;
    adapterConfig: string;
    labels: string;
    branch: string;
    githubIssueNumber: number;
    githubIssueUrl: string;
    estimatedEffort: string;
  }>) {
    const updateData: Record<string, any> = { updatedAt: new Date() };

    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.position !== undefined) updateData.position = data.position;
    if (data.parentTaskId !== undefined) updateData.parentTaskId = data.parentTaskId;
    if (data.assigneeType !== undefined) updateData.assigneeType = data.assigneeType;
    if (data.assigneeId !== undefined) updateData.assigneeId = data.assigneeId;
    if (data.sessionId !== undefined) updateData.sessionId = data.sessionId;
    if (data.autoFlow !== undefined) updateData.autoFlow = data.autoFlow;
    if (data.adapterType !== undefined) updateData.adapterType = data.adapterType;
    if (data.adapterConfig !== undefined) updateData.adapterConfig = data.adapterConfig;
    if (data.labels !== undefined) updateData.labels = data.labels;
    if (data.branch !== undefined) updateData.branch = data.branch;
    if (data.githubIssueNumber !== undefined) updateData.githubIssueNumber = data.githubIssueNumber;
    if (data.githubIssueUrl !== undefined) updateData.githubIssueUrl = data.githubIssueUrl;
    if (data.estimatedEffort !== undefined) updateData.estimatedEffort = data.estimatedEffort;

    await db.update(kanbanTasks)
      .set(updateData)
      .where(and(eq(kanbanTasks.id, taskId), eq(kanbanTasks.userId, userId)));

    return this.findTaskById(taskId, userId);
  }

  async moveTask(taskId: string, userId: string, newStatus: string, newPosition: number) {
    await db.update(kanbanTasks)
      .set({ status: newStatus as any, position: newPosition, updatedAt: new Date() })
      .where(and(eq(kanbanTasks.id, taskId), eq(kanbanTasks.userId, userId)));

    return this.findTaskById(taskId, userId);
  }

  async deleteTask(taskId: string, userId: string) {
    await db.delete(kanbanTasks)
      .where(and(eq(kanbanTasks.id, taskId), eq(kanbanTasks.userId, userId)));
    return { success: true };
  }

  // ─── Dependencies ──────────────────────────────────────────────────────

  async addDependency(taskId: string, dependsOnTaskId: string) {
    const id = nanoid();
    await db.insert(kanbanTaskDependencies).values({
      id,
      taskId,
      dependsOnTaskId,
      createdAt: new Date(),
    });
    return { id, taskId, dependsOnTaskId };
  }

  async removeDependency(id: string) {
    await db.delete(kanbanTaskDependencies).where(eq(kanbanTaskDependencies.id, id));
    return { success: true };
  }

  async getBlockingTasks(taskId: string) {
    return db.query.kanbanTaskDependencies.findMany({
      where: eq(kanbanTaskDependencies.taskId, taskId),
      with: { dependsOn: true },
    });
  }

  async isBlocked(taskId: string): Promise<boolean> {
    const deps = await this.getBlockingTasks(taskId);
    return deps.some(d => (d.dependsOn as any)?.status !== 'completed');
  }

  // ─── Comments ──────────────────────────────────────────────────────────

  async findComments(taskId: string) {
    return db.query.kanbanTaskComments.findMany({
      where: and(
        eq(kanbanTaskComments.taskId, taskId),
        isNull(kanbanTaskComments.parentCommentId),
      ),
      with: {
        user: true,
        replies: {
          with: { user: true },
          orderBy: [asc(kanbanTaskComments.createdAt)],
        },
        attachments: true,
      },
      orderBy: [asc(kanbanTaskComments.createdAt)],
    });
  }

  async createComment(data: { taskId: string; userId: string; content: string; parentCommentId?: string }) {
    const id = nanoid();
    await db.insert(kanbanTaskComments).values({
      id,
      taskId: data.taskId,
      userId: data.userId,
      parentCommentId: data.parentCommentId || null,
      content: data.content,
      status: 'open',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return db.query.kanbanTaskComments.findFirst({
      where: eq(kanbanTaskComments.id, id),
      with: { user: true, attachments: true },
    });
  }

  async updateCommentStatus(commentId: string, status: 'open' | 'resolved' | 'rejected', resolvedBy?: string) {
    await db.update(kanbanTaskComments)
      .set({ status, resolvedBy: resolvedBy || null, updatedAt: new Date() })
      .where(eq(kanbanTaskComments.id, commentId));

    return db.query.kanbanTaskComments.findFirst({
      where: eq(kanbanTaskComments.id, commentId),
      with: { user: true },
    });
  }

  async deleteComment(commentId: string) {
    await db.delete(kanbanTaskComments).where(eq(kanbanTaskComments.id, commentId));
    return { success: true };
  }

  // ─── Attachments ────────────────────────────────────────────────────────

  async createAttachment(data: {
    taskId: string;
    commentId?: string;
    userId: string;
    filename: string;
    filepath: string;
    mimetype: string;
    size: number;
  }) {
    const id = nanoid();
    await db.insert(kanbanTaskAttachments).values({
      id,
      ...data,
      commentId: data.commentId || null,
      createdAt: new Date(),
    });
    return db.query.kanbanTaskAttachments.findFirst({
      where: eq(kanbanTaskAttachments.id, id),
    });
  }

  async deleteAttachment(attachmentId: string) {
    const attachment = await db.query.kanbanTaskAttachments.findFirst({
      where: eq(kanbanTaskAttachments.id, attachmentId),
    });
    if (attachment) {
      // Delete file from disk
      try { await Bun.file(attachment.filepath).exists() && await import('fs/promises').then(fs => fs.unlink(attachment.filepath)); } catch {}
    }
    await db.delete(kanbanTaskAttachments).where(eq(kanbanTaskAttachments.id, attachmentId));
    return { success: true };
  }

  // ─── Board Summary ─────────────────────────────────────────────────────

  async getBoardSummary(userId: string, projectId?: string) {
    const conditions = [eq(kanbanTasks.userId, userId)];
    if (projectId) conditions.push(eq(kanbanTasks.projectId, projectId));

    // Get counts per status
    const result = await db.select({
      status: kanbanTasks.status,
      count: sql<number>`count(*)::int`,
    })
      .from(kanbanTasks)
      .where(and(...conditions))
      .groupBy(kanbanTasks.status);

    return result.reduce((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {} as Record<string, number>);
  }
}

export const kanbanRepository = new KanbanRepository();
