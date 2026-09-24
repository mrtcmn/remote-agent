import { eq } from 'drizzle-orm';
import { db, claudeSessions, kanbanTasks, projects, worktrees } from '../../db';
import { terminalService } from '../terminal';
import { cliAdapterRegistry } from '../cli-adapter';
import { kanbanRepository } from './kanban.repository';
import { extractText, parseChecklist, unwrapMarkdown, type ChecklistItem } from './agent-plan.service';

/**
 * Closes the loops between a task and the agent working it:
 *  - the column follows the linked session (working → In Progress, stopped → Review Needed),
 *  - the goal gates the move out of In Progress: a referee agent judges whether the
 *    goal is met, and its verdict goes back to the worker until it passes or the
 *    attempts run out,
 *  - review comments go back to the agent on request.
 *
 * The goal is prose, not a command, because the interesting ones are not commands:
 * "the bench is 30% faster than main" needs someone to run the bench on both sides
 * and compare. The referee has a shell and does exactly that.
 */

// ponytail: fixed budget. Make it a per-task field if one number stops fitting.
export const MAX_VERIFY_ATTEMPTS = 3;
const OUTPUT_TAIL = 4000;
// How long a "done" signal is ignored after feedback goes out. Long enough to
// cover the stop signal of the turn before the paste, short enough that an
// agent which answers in prose and never calls a tool does not freeze the card.
const AWAIT_WORK_MS = 60_000;
const AGENT_TERMINALS = new Set(['claude', 'opencode', 'kimi']);
// The referee reads and runs, and is told not to write. It needs Bash: a goal about
// tests, a benchmark or a baseline can only be settled by running something.
const JUDGE_TOOLS = ['Read', 'Grep', 'Glob', 'Bash'];
const DRAFT_TOOLS = ['Read', 'Grep', 'Glob'];

export type AgentSignal = 'working' | 'done';

/**
 * Where a session signal moves the card, or null to leave it. Manual Testing is
 * absent on purpose: an agent moves itself there and keeps making tool calls, so
 * "working" must not pull it back.
 */
export function columnForSignal(signal: AgentSignal, status: string): string | null {
  if (signal === 'working') {
    return ['backlog', 'todo', 'review_needed'].includes(status) ? 'in_progress' : null;
  }
  return status === 'in_progress' ? 'review_needed' : null;
}

export interface Verdict {
  pass: boolean;
  reason: string;
  evidence?: string;
}

export interface GateResult {
  pass: boolean;
  feedback: string;
  /** What the board records and shows: the verdict, with the evidence under it. */
  record: string;
}

/**
 * Every balanced `{...}` in the text. A brace inside a JSON string does not
 * count — the evidence holds shell commands, and `awk '{print $1}'` is normal.
 */
function jsonObjects(raw: string): string[] {
  const found: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0) found.push(raw.slice(start, i + 1));
    }
  }
  return found;
}

/** The referee answers with one JSON object. Take the last one; a missing verdict is a fail. */
export function parseVerdict(raw: string): Verdict {
  for (const candidate of jsonObjects(raw).reverse()) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed.pass === 'boolean') {
        return {
          pass: parsed.pass,
          reason: String(parsed.reason ?? '').trim(),
          evidence: parsed.evidence ? String(parsed.evidence).trim() : undefined,
        };
      }
    } catch {
      // Keep looking: prose around the object, or a half-written one.
    }
  }
  return { pass: false, reason: `The referee gave no verdict. It said:\n${raw.slice(-1000)}` };
}

/** The task may leave In Progress only when the referee passes it and no checklist item is open. */
export function gate(verdict: Verdict, checklist: ChecklistItem[]): GateResult {
  const open = checklist.map((it, i) => ({ ...it, i })).filter(it => !it.done);
  const pass = verdict.pass && open.length === 0;
  const record = [verdict.reason, verdict.evidence].filter(Boolean).join('\n\n');
  if (pass) return { pass, feedback: '', record };

  return {
    pass,
    record,
    feedback: [
      'The board judged your work against the task goal, and the goal is not met yet.',
      '',
      verdict.pass ? 'The referee passed the goal itself.' : `Referee: ${verdict.reason}`,
      verdict.evidence ? ['', 'Evidence:', '```', verdict.evidence, '```'].join('\n') : '',
      open.length
        ? ['', 'These checklist items are still open:', ...open.map(it => `${it.i}. ${it.text}`)].join('\n')
        : '',
      '',
      'Fix it, tick the items with `check_item` as you finish them, then stop.',
      'The board judges it again when you stop.',
    ].filter(Boolean).join('\n'),
  };
}

export function buildJudgePrompt(task: {
  title: string;
  goal: string;
  description?: string | null;
  checklist?: string | null;
}): string {
  const items = parseChecklist(task.checklist);
  return [
    'You are the referee for one Kanban task. An agent says it is finished. Decide',
    'whether the goal below is met. Change no file — you judge, you do not fix.',
    '',
    `Task: ${task.title}`,
    task.description ? `Details: ${task.description}` : '',
    '',
    '--- GOAL ---',
    task.goal,
    '--- END GOAL ---',
    '',
    items.length ? ['The worker\'s checklist, for context:', ...items.map((it, i) => `${i}. [${it.done ? 'x' : ' '}] ${it.text}`), ''].join('\n') : '',
    'Prove it or disprove it with the shell: run the tests, the type check, the',
    'benchmark. When the goal names a baseline, measure both sides — check out or',
    'stash nothing, use git to read the old version instead, for example',
    '`git stash list`, `git show HEAD:path`, or a worktree you remove afterwards.',
    'Trust numbers you produced, never a claim in the code or a comment.',
    'A goal with a threshold is met only when your own measurement crosses it.',
    '',
    'Reply with one JSON object and nothing else:',
    '{"pass": true, "reason": "one or two sentences", "evidence": "the commands you ran and the numbers they gave"}',
  ].filter(Boolean).join('\n');
}

export function buildGoalDraftPrompt(task: { title: string; description?: string | null; planDoc?: string | null }): string {
  return [
    'Write the goal for one Kanban task: the statement a referee will later check to',
    'decide whether the work is done. Read the repository first. Change no file.',
    '',
    `Task: ${task.title}`,
    task.description ? `Details: ${task.description}` : '',
    task.planDoc ? `\n--- PLAN ---\n${task.planDoc}\n--- END PLAN ---` : '',
    '',
    'Rules for the goal:',
    '- Three to six lines, each one a condition a referee can check by running something.',
    '- Name the real command, file or test from this repository, never a made-up one.',
    '- Put a number on anything about speed, size or coverage, and name the baseline',
    '  it is measured against. "30% faster than main on `bun run bench`" is a goal;',
    '  "faster" is not.',
    '- Say what must NOT break, when that is the real risk.',
    '- Leave out anything the diff already shows. The goal is the outcome, not the steps.',
    '',
    'Reply with the goal only — plain lines, no heading, no preamble.',
  ].filter(Boolean).join('\n');
}

export function buildReviewPrompt(taskTitle: string, comments: string[], note?: string): string {
  return [
    `Review feedback on the task "${taskTitle}".`,
    '',
    ...comments.map((c, i) => `${i + 1}. ${c}`),
    note ? `\n${note}` : '',
    '',
    'Address each point. Reply on the task with `comment_task` when you finish.',
  ].filter(Boolean).join('\n');
}

function tail(text: string): string {
  return text.length > OUTPUT_TAIL ? text.slice(-OUTPUT_TAIL) : text;
}

type Task = NonNullable<Awaited<ReturnType<typeof kanbanRepository.findTaskById>>>;

async function setTask(taskId: string, patch: Partial<typeof kanbanTasks.$inferInsert>) {
  await db.update(kanbanTasks).set({ ...patch, updatedAt: new Date() }).where(eq(kanbanTasks.id, taskId));
}

/** The checkout the agent works in: the session's worktree, else the project root. */
async function workDir(task: Task): Promise<string> {
  if (task.sessionId) {
    const session = await db.query.claudeSessions.findFirst({ where: eq(claudeSessions.id, task.sessionId) });
    if (session?.worktreeId) {
      const wt = await db.query.worktrees.findFirst({ where: eq(worktrees.id, session.worktreeId) });
      if (wt) return wt.path;
    }
  }
  const project = await db.query.projects.findFirst({ where: eq(projects.id, task.projectId) });
  if (!project) throw new Error('Project not found');
  return project.localPath;
}

class TaskLoopService {
  // ponytail: in-memory, like agentPlanService.running — one API process owns
  // its agents. Move both to a DB lease if the API ever runs multi-node.
  private verifying = new Set<string>();
  // Feedback was sent at this time; ignore "done" for a short while after it, or
  // the stop signal of the turn that came before the paste would run the check
  // again before the agent has changed anything. It expires, because an agent
  // that answers with text and no tool call never signals "working".
  private awaitingWork = new Map<string, number>();
  private drafting = new Set<string>();
  // Held for the whole of one onAgentDone, and taken before the first await:
  // two hooks report the same stop, and both must not judge the same task.
  private deciding = new Set<string>();

  /** A signal from a session linked to one or more tasks. */
  async onSessionSignal(sessionId: string, signal: AgentSignal) {
    const tasks = await kanbanRepository.findTasksBySession(sessionId);
    for (const task of tasks) {
      if (signal === 'working') {
        this.awaitingWork.delete(task.id);
        const next = columnForSignal('working', task.status);
        if (next) await setTask(task.id, { status: next as never });
      } else {
        await this.onAgentDone(task.id, task.userId);
      }
    }
  }

  /** The agent stopped. Gate the move out of In Progress on the goal. */
  async onAgentDone(taskId: string, userId: string) {
    if (this.verifying.has(taskId) || this.deciding.has(taskId)) return;
    const sentAt = this.awaitingWork.get(taskId);
    if (sentAt !== undefined && Date.now() - sentAt < AWAIT_WORK_MS) return;
    this.awaitingWork.delete(taskId);

    this.deciding.add(taskId);
    try {
      const task = await kanbanRepository.findTaskById(taskId, userId);
      // Only a task still In Progress moves. An agent that moved itself keeps its call.
      if (!task || task.status !== 'in_progress') return;

      if (!task.goal) {
        await setTask(taskId, { status: 'review_needed' as never });
        return;
      }
      if (task.verifyStatus === 'stuck') return;

      const result = await this.check(task);
      if (result.pass) return;

      const attempts = task.verifyAttempts + 1;
      if (attempts >= MAX_VERIFY_ATTEMPTS) {
        await setTask(taskId, { verifyStatus: 'stuck', verifyAttempts: attempts });
        await kanbanRepository.createComment({
          taskId,
          userId,
          kind: 'result',
          content: `Verify failed ${attempts} times. The loop stopped — check the output on the task, then send it back.\n\n${result.feedback}`,
        });
        return;
      }
      await setTask(taskId, { verifyAttempts: attempts });
      await this.sendToAgent(task, result.feedback);
    } finally {
      this.deciding.delete(taskId);
    }
  }

  /** Runs the referee once and records the verdict. A pass moves an In Progress task to review. */
  async check(task: Task): Promise<GateResult> {
    this.verifying.add(task.id);
    try {
      await setTask(task.id, { verifyStatus: 'running' });
      let verdict: Verdict;
      try {
        const raw = await this.runHeadless(task, buildJudgePrompt({ ...task, goal: task.goal! }), JUDGE_TOOLS);
        verdict = parseVerdict(raw);
      } catch (error) {
        verdict = { pass: false, reason: `The referee could not run: ${(error as Error).message}` };
      }
      const result = gate(verdict, parseChecklist(task.checklist));
      await setTask(task.id, {
        verifyStatus: result.pass ? 'passed' : 'failed',
        verifyOutput: tail(result.record),
        ...(result.pass ? { verifyAttempts: 0 } : {}),
      });
      if (result.pass) {
        const current = await kanbanRepository.findTaskById(task.id, task.userId);
        if (current?.status === 'in_progress') await setTask(task.id, { status: 'review_needed' as never });
      }
      return result;
    } finally {
      this.verifying.delete(task.id);
    }
  }

  /** Manual "Check now" — records the verdict, never sends feedback or spends an attempt. */
  async verifyNow(taskId: string, userId: string, goal?: string) {
    const task = await kanbanRepository.findTaskById(taskId, userId);
    if (!task) throw new Error('Task not found');
    if (this.verifying.has(taskId)) throw new Error('The referee is already running');
    const judged = goal?.trim() || task.goal;
    if (!judged) throw new Error('This task has no goal');
    if (judged !== task.goal) await setTask(taskId, { goal: judged, verifyAttempts: 0 });
    void this.check({ ...task, goal: judged }).catch(err => console.error('[task-loop] verify failed:', err));
    return kanbanRepository.findTaskById(taskId, userId);
  }

  /** "Send back to agent": open review comments go to the agent, the loop starts fresh. */
  async sendBack(taskId: string, userId: string, note?: string) {
    const task = await kanbanRepository.findTaskById(taskId, userId);
    if (!task) throw new Error('Task not found');

    const open: string[] = [];
    for (const c of task.comments) {
      if (c.kind !== 'user') continue;
      if (c.status === 'open') open.push(c.content);
      for (const r of c.replies ?? []) {
        if (r.kind === 'user' && r.status === 'open') open.push(`(reply to "${c.content.slice(0, 60)}") ${r.content}`);
      }
    }
    if (!open.length && !note?.trim()) throw new Error('No open comments to send');

    await setTask(taskId, { status: 'in_progress' as never, verifyStatus: 'none', verifyAttempts: 0 });
    await this.sendToAgent(task, buildReviewPrompt(task.title, open, note?.trim()));
    return kanbanRepository.findTaskById(taskId, userId);
  }

  /**
   * Writes the task's goal with a read-only agent, off the request path. The
   * planner writes one too; this is for a task nobody planned.
   */
  async draftGoal(taskId: string, userId: string) {
    const task = await kanbanRepository.findTaskById(taskId, userId);
    if (!task) throw new Error('Task not found');
    if (this.drafting.has(taskId)) throw new Error('A goal is already being written');

    this.drafting.add(taskId);
    await setTask(taskId, { verifyStatus: 'drafting' });
    void (async () => {
      try {
        const raw = await this.runHeadless(task, buildGoalDraftPrompt(task), DRAFT_TOOLS);
        const goal = unwrapMarkdown(raw).trim();
        await setTask(taskId, { verifyStatus: 'none', verifyAttempts: 0, ...(goal ? { goal } : {}) });
      } catch (error) {
        console.error('[task-loop] goal draft failed:', error);
        await setTask(taskId, { verifyStatus: 'none' }).catch(() => {});
      } finally {
        this.drafting.delete(taskId);
      }
    })();

    return { drafting: true };
  }

  isDrafting(taskId: string): boolean {
    return this.drafting.has(taskId);
  }

  /** One headless CLI run in the task's checkout, waited on. */
  private async runHeadless(task: Task, prompt: string, allowedTools: string[]): Promise<string> {
    const adapter = cliAdapterRegistry.get(task.adapterType || 'claude_code');
    if (!adapter) throw new Error(`No CLI adapter for ${task.adapterType}`);
    const result = await adapter.startSession({
      projectPath: await workDir(task),
      branch: task.branch || undefined,
      prompt,
      allowedTools,
    });
    // The adapter reports a failed run in the result, not by throwing. Without
    // this, a missing CLI becomes a failed verdict, or a goal made of an error.
    if (!result.success) throw new Error(extractText(result.output).slice(0, 500) || 'The agent run failed');
    return extractText(result.output);
  }

  /**
   * Types the text into the linked session's agent terminal. With no live
   * session, a background executor run picks it up instead.
   */
  private async sendToAgent(task: Task, text: string) {
    this.awaitingWork.set(task.id, Date.now());
    const terminal = task.sessionId
      ? terminalService.getSessionTerminals(task.sessionId)
          .find(t => AGENT_TERMINALS.has(t.type) && t.status === 'running' && t.terminal)
      : undefined;

    if (terminal) {
      // Bracketed paste keeps a multi-line prompt as one message; Enter submits it.
      // ponytail: the pause lets the TUI finish taking the paste before Enter.
      await terminalService.write(terminal.id, `\x1b[200~${text}\x1b[201~`);
      await Bun.sleep(150);
      await terminalService.write(terminal.id, '\r');
      return;
    }

    const { agentPlanService } = await import('./agent-plan.service');
    try {
      await agentPlanService.execute(task.id, task.userId, text);
    } catch (error) {
      this.awaitingWork.delete(task.id);
      throw error;
    }
  }

  /**
   * No agent survives a restart, so no task is still being judged. Without this,
   * a card shows "Judging" for ever and the client polls it every 3 seconds.
   */
  async initialize() {
    await db.update(kanbanTasks)
      .set({ verifyStatus: 'failed' })
      .where(eq(kanbanTasks.verifyStatus, 'running'));
    await db.update(kanbanTasks)
      .set({ verifyStatus: 'none' })
      .where(eq(kanbanTasks.verifyStatus, 'drafting'));
  }

  /** The background executor has started on the feedback. */
  markWorking(taskId: string) {
    this.awaitingWork.delete(taskId);
  }
}

export const taskLoopService = new TaskLoopService();
