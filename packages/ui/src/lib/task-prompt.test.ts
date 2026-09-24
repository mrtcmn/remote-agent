import { describe, expect, it } from 'bun:test';
import { buildSessionPrompt, parseChecklist } from './task-prompt';
import type { KanbanTask } from './api';

const task = (over: Partial<KanbanTask> = {}): KanbanTask => ({
  id: 'task_42', projectId: 'p1', parentTaskId: null, userId: 'u',
  title: 'Add the checklist', description: null, status: 'todo', priority: 'medium', position: 0,
  assigneeType: 'agent', assigneeId: null, sessionId: null,
  githubIssueNumber: null, githubIssueUrl: null, branch: null,
  autoFlow: false, adapterType: null, adapterConfig: null,
  labels: null, estimatedEffort: null, planDoc: null, planStatus: 'none', checklist: null,
  goal: null, verifyStatus: 'none', verifyAttempts: 0, verifyOutput: null, prUrl: null,
  createdAt: '', updatedAt: '',
  ...over,
});

describe('parseChecklist', () => {
  it('reads a stored list and survives broken JSON', () => {
    expect(parseChecklist('[{"text":"a","done":false}]')).toEqual([{ text: 'a', done: false }]);
    expect(parseChecklist('{')).toEqual([]);
    expect(parseChecklist(null)).toEqual([]);
  });
});

describe('buildSessionPrompt', () => {
  it('names the task and the board tools', () => {
    const p = buildSessionPrompt(task());
    expect(p).toContain('This is a Remote Agent task');
    expect(p).toContain('task_42');
    expect(p).toContain('comment_task');
    expect(p).toContain('update_task');
  });

  it('includes the plan when there is one, and says to check it first', () => {
    const p = buildSessionPrompt(task({ planDoc: '## Steps\n1. do it' }));
    expect(p).toContain('--- END PLAN ---');
    expect(p).toContain('confirming the plan still matches');
  });

  it('asks the agent to state its intent when there is no plan', () => {
    expect(buildSessionPrompt(task())).toContain('before you change anything');
  });

  it('renders the checklist with the indexes check_item expects', () => {
    const p = buildSessionPrompt(task({ checklist: '[{"text":"One","done":true},{"text":"Two","done":false}]' }));
    expect(p).toContain('0. [x] One');
    expect(p).toContain('1. [ ] Two');
    expect(p).toContain('check_item');
  });

  it('offers set_checklist when the task has none', () => {
    expect(buildSessionPrompt(task())).toContain('set_checklist');
  });
});
