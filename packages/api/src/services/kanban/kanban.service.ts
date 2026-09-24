import { kanbanRepository, type TaskFilters, type TaskListOptions } from './kanban.repository';
import { autoFlowService } from '../auto-flow';

const KANBAN_STATUSES = ['backlog', 'todo', 'in_progress', 'manual_testing', 'review_needed', 'completed'] as const;
type KanbanStatus = typeof KANBAN_STATUSES[number];

export interface RunningProject {
  projectId: string;
  projectName: string;
  sessions: number;
}

export type ActiveProject =
  | { resolved: true; projectId: string; projectName: string; sessions: number }
  | { resolved: false; reason: 'none' | 'ambiguous'; candidates: RunningProject[] };

/**
 * One project with live sessions is an answer. Nothing running, or several
 * projects running at once, is a question — return the candidates instead of
 * picking, so the caller asks rather than guesses.
 */
export function pickActiveProject(running: RunningProject[]): ActiveProject {
  if (running.length === 1) {
    return { resolved: true, ...running[0] };
  }
  return {
    resolved: false,
    reason: running.length === 0 ? 'none' : 'ambiguous',
    candidates: running,
  };
}

class KanbanService {
  // ─── Task CRUD ──────────────────────────────────────────────────────────

  async getTasks(userId: string, options?: TaskListOptions) {
    return kanbanRepository.findTasks(userId, options);
  }

  async getTask(taskId: string, userId: string) {
    return kanbanRepository.findTaskById(taskId, userId);
  }

  async createTask(userId: string, data: {
    projectId: string;
    title: string;
    description?: string;
    status?: string;
    priority?: string;
    parentTaskId?: string;
    assigneeType?: string;
    assigneeId?: string;
    autoFlow?: boolean;
    adapterType?: string;
    labels?: string[];
    checklist?: { text: string; done?: boolean }[];
    branch?: string;
    githubIssueNumber?: number;
    githubIssueUrl?: string;
    goal?: string;
  }) {
    return kanbanRepository.createTask({
      ...data,
      userId,
      labels: data.labels ? JSON.stringify(data.labels) : undefined,
      checklist: data.checklist
        ? JSON.stringify(data.checklist.map(i => ({ text: i.text, done: !!i.done })))
        : undefined,
    });
  }

  async updateTask(taskId: string, userId: string, data: Record<string, any>) {
    if (data.labels && Array.isArray(data.labels)) {
      data.labels = JSON.stringify(data.labels);
    }
    if (data.checklist && Array.isArray(data.checklist)) {
      data.checklist = JSON.stringify(
        data.checklist.map((i: { text: string; done?: boolean }) => ({ text: i.text, done: !!i.done })),
      );
    }
    // An agent writes this field through update_task, so it is a trust
    // boundary: a javascript: URL would run in the app when the chip is clicked.
    if (data.prUrl !== undefined && data.prUrl !== null) {
      const url = String(data.prUrl).trim();
      if (!url) data.prUrl = null;
      else if (!/^https?:\/\//i.test(url)) throw new Error('A pull request URL must start with http:// or https://');
      else data.prUrl = url;
    }
    // A new goal starts a fresh loop.
    if ('goal' in data) {
      data.goal = data.goal?.trim() || null;
      data.verifyStatus = 'none';
      data.verifyAttempts = 0;
    }
    // Moving a task points the agent at a different directory, so the target
    // project must be one this user owns.
    if (data.projectId && !(await kanbanRepository.userOwnsProject(data.projectId, userId))) {
      throw new Error('Unknown project');
    }
    const before = data.status === 'completed' ? await kanbanRepository.findTaskById(taskId, userId) : null;
    const task = await kanbanRepository.updateTask(taskId, userId, data);
    // An agent finishes a task through update_task, not drag-and-drop, so this
    // path must start dependents too.
    if (before && before.status !== 'completed') this.startDependents(taskId, userId);
    return task;
  }

  async moveTask(taskId: string, userId: string, newStatus: string, newPosition: number) {
    // Validate status
    if (!KANBAN_STATUSES.includes(newStatus as KanbanStatus)) {
      throw new Error(`Invalid status: ${newStatus}`);
    }

    // Check if task is blocked
    if (newStatus !== 'backlog' && newStatus !== 'todo') {
      const blocked = await kanbanRepository.isBlocked(taskId);
      if (blocked) {
        throw new Error('Task is blocked by incomplete dependencies');
      }
    }

    const before = newStatus === 'completed' ? await kanbanRepository.findTaskById(taskId, userId) : null;
    const task = await kanbanRepository.moveTask(taskId, userId, newStatus, newPosition);
    if (before && before.status !== 'completed') this.startDependents(taskId, userId);
    return task;
  }

  async deleteTask(taskId: string, userId: string) {
    return kanbanRepository.deleteTask(taskId, userId);
  }

  // ─── Which project am I working in? ────────────────────────────────────

  /**
   * A task belongs to exactly one project, and the agent runs in that
   * project's directory — so a wrong guess sends it into the wrong repo.
   * Answer only when the answer is obvious; otherwise hand back the
   * candidates so the caller can ask.
   */
  async getActiveProject(userId: string): Promise<ActiveProject> {
    return pickActiveProject(await kanbanRepository.findRunningProjects(userId));
  }

  // ─── Checklist ─────────────────────────────────────────────────────────
  // Stored as a JSON array on the task, like `labels`. Optional: a task with
  // no checklist is normal, not empty.

  async setChecklist(taskId: string, userId: string, items: { text: string; done?: boolean }[]) {
    const checklist = items.map(i => ({ text: i.text, done: !!i.done }));
    return kanbanRepository.updateTask(taskId, userId, { checklist: JSON.stringify(checklist) });
  }

  /** Ticks one item. Kept as its own call so an agent needs one round trip. */
  async setChecklistItem(taskId: string, userId: string, index: number, done: boolean) {
    const task = await kanbanRepository.findTaskById(taskId, userId);
    if (!task) throw new Error('Task not found');

    const items: { text: string; done: boolean }[] = task.checklist ? JSON.parse(task.checklist) : [];
    if (index < 0 || index >= items.length) {
      throw new Error(`No checklist item ${index}. The task has ${items.length}.`);
    }

    items[index].done = done;
    return kanbanRepository.updateTask(taskId, userId, { checklist: JSON.stringify(items) });
  }

  // ─── Dependencies ──────────────────────────────────────────────────────

  async addDependency(taskId: string, dependsOnTaskId: string, userId: string) {
    // Prevent self-dependency
    if (taskId === dependsOnTaskId) {
      throw new Error('A task cannot depend on itself');
    }
    // A dependency starts an agent in the dependent task's directory, so both
    // ends must belong to the caller.
    const [task, blocker] = await Promise.all([
      kanbanRepository.findTaskById(taskId, userId),
      kanbanRepository.findTaskById(dependsOnTaskId, userId),
    ]);
    if (!task || !blocker) throw new Error('Unknown task');
    // Prevent circular dependencies (simple check)
    const reverseCheck = await kanbanRepository.getBlockingTasks(dependsOnTaskId);
    if (reverseCheck.some(d => d.dependsOnTaskId === taskId)) {
      throw new Error('Circular dependency detected');
    }
    return kanbanRepository.addDependency(taskId, dependsOnTaskId);
  }

  async removeDependency(id: string, userId: string) {
    return kanbanRepository.removeDependency(id, userId);
  }

  // ─── Comments ──────────────────────────────────────────────────────────

  async getComments(taskId: string) {
    return kanbanRepository.findComments(taskId);
  }

  async addComment(taskId: string, userId: string, content: string, parentCommentId?: string, kind?: 'user' | 'result') {
    return kanbanRepository.createComment({ taskId, userId, content, parentCommentId, kind });
  }

  async resolveComment(commentId: string, userId: string) {
    return kanbanRepository.updateCommentStatus(commentId, 'resolved', userId);
  }

  async rejectComment(commentId: string, userId: string) {
    return kanbanRepository.updateCommentStatus(commentId, 'rejected', userId);
  }

  async reopenComment(commentId: string) {
    return kanbanRepository.updateCommentStatus(commentId, 'open');
  }

  async deleteComment(commentId: string) {
    return kanbanRepository.deleteComment(commentId);
  }

  // ─── Attachments ────────────────────────────────────────────────────────

  async addAttachment(data: {
    taskId: string;
    commentId?: string;
    userId: string;
    filename: string;
    filepath: string;
    mimetype: string;
    size: number;
  }) {
    return kanbanRepository.createAttachment(data);
  }

  async deleteAttachment(attachmentId: string) {
    return kanbanRepository.deleteAttachment(attachmentId);
  }

  // ─── Board ──────────────────────────────────────────────────────────────

  async getBoardData(userId: string, projectId?: string) {
    const tasks = await kanbanRepository.findTasks(userId, {
      filters: {
        projectId,
        parentTaskId: null, // Top-level tasks only for board view
      },
      // ponytail: the board draws every card, so it must not page. Add real
      // paging if a project ever carries more than this many open tasks.
      limit: 1000,
    });

    // Group tasks by status. The count is what the column actually holds —
    // a separate COUNT(*) counted subtasks the board never draws.
    const columns = KANBAN_STATUSES.map(status => {
      const columnTasks = tasks
        .filter(t => t.status === status)
        .sort((a, b) => a.position - b.position);
      return {
        id: status,
        title: this.getColumnTitle(status),
        tasks: columnTasks,
        count: columnTasks.length,
      };
    });

    return { columns };
  }

  async getStatuses() {
    return KANBAN_STATUSES.map(status => ({
      id: status,
      title: this.getColumnTitle(status),
    }));
  }

  // ─── Auto-flow trigger ─────────────────────────────────────────────────

  /** Off the request path: dependents with auto-flow on start once all their blockers are done. */
  private startDependents(completedTaskId: string, userId: string) {
    autoFlowService.onTaskCompleted(completedTaskId, userId).catch(err => {
      console.error('[kanban] Auto-flow trigger error:', err);
    });
  }

  private getColumnTitle(status: string): string {
    const titles: Record<string, string> = {
      backlog: 'Backlog',
      todo: 'To Do',
      in_progress: 'In Progress',
      manual_testing: 'Manual Testing',
      review_needed: 'Review Needed',
      completed: 'Completed',
    };
    return titles[status] || status;
  }
}

export const kanbanService = new KanbanService();
