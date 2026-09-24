import { describe, expect, it } from 'bun:test';
import { filterBoard, type BoardFilters } from './kanban-filter';
import type { KanbanBoardData, KanbanTask } from './api';

const task = (over: Partial<KanbanTask>): KanbanTask => ({
  id: 'x', projectId: 'p', parentTaskId: null, userId: 'u',
  title: 'Task', description: null, status: 'todo', priority: 'medium', position: 0,
  assigneeType: 'unassigned', assigneeId: null, sessionId: null,
  githubIssueNumber: null, githubIssueUrl: null, branch: null,
  autoFlow: false, adapterType: null, adapterConfig: null,
  labels: null, estimatedEffort: null, planDoc: null, planStatus: 'none',
  checklist: null, goal: null, verifyStatus: 'none', verifyAttempts: 0, verifyOutput: null, prUrl: null,
  createdAt: '', updatedAt: '',
  ...over,
});

const board = (tasks: KanbanTask[]): KanbanBoardData => ({
  columns: [
    { id: 'todo', title: 'To Do', tasks, count: tasks.length },
    { id: 'completed', title: 'Completed', tasks: [], count: 0 },
  ],
});

const none: BoardFilters = { status: [], priority: [], search: '' };

describe('filterBoard', () => {
  it('keeps every column and card when nothing is set', () => {
    const result = filterBoard(board([task({ id: 'a' })]), none);
    expect(result.columns).toHaveLength(2);
    expect(result.columns[0].tasks).toHaveLength(1);
  });

  it('recomputes the count so the badge matches the visible cards', () => {
    const data = board([task({ id: 'a', priority: 'critical' }), task({ id: 'b', priority: 'low' })]);
    const result = filterBoard(data, { ...none, priority: ['critical'] });
    expect(result.columns[0].tasks).toHaveLength(1);
    expect(result.columns[0].count).toBe(1);
  });

  it('keeps only the selected status columns', () => {
    const result = filterBoard(board([]), { ...none, status: ['completed'] });
    expect(result.columns.map((c) => c.id)).toEqual(['completed']);
  });

  it('searches the description as well as the title', () => {
    const data = board([
      task({ id: 'a', title: 'Fix login', description: null }),
      task({ id: 'b', title: 'Chore', description: 'touches the login form' }),
    ]);
    const result = filterBoard(data, { ...none, search: 'LOGIN' });
    expect(result.columns[0].tasks.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('ignores a whitespace-only search', () => {
    const result = filterBoard(board([task({ id: 'a' })]), { ...none, search: '   ' });
    expect(result.columns[0].tasks).toHaveLength(1);
  });

  it('filters by assignee', () => {
    const data = board([task({ id: 'a', assigneeType: 'agent' }), task({ id: 'b', assigneeType: 'user' })]);
    const result = filterBoard(data, { ...none, assignee: 'agent' });
    expect(result.columns[0].tasks.map((t) => t.id)).toEqual(['a']);
  });
});
