import { eq } from 'drizzle-orm';
import { db, kanbanTasks, projects } from '../../db';
import { cliAdapterRegistry } from '../cli-adapter';
import { kanbanRepository } from './kanban.repository';
import { kanbanService } from './kanban.service';
import { taskLoopService } from './task-loop.service';

export type PlanStatus = 'none' | 'planning' | 'ready' | 'executing' | 'done' | 'failed';

// Headless `--print` runs cannot answer a permission prompt, so every tool the
// agent needs must be named up front. The planner only reads.
const PLAN_TOOLS = ['Read', 'Grep', 'Glob'];
// `mcp__remote-agent` lets the executor write back to the board it came from:
// tick the checklist, comment, move the status. Without it the whitelist would
// deny every MCP call and the agent would work blind.
const EXECUTE_TOOLS = [...PLAN_TOOLS, 'Edit', 'Write', 'Bash', 'mcp__remote-agent'];

// Every type below was rendered against this app's mermaid build before it was
// listed. `swimlane-beta` is deliberately absent: it does not parse here.
const DIAGRAM_MENU = `| The reader asks | Use |
| --- | --- |
| What talks to what, and what do I touch? | \`flowchart LR\` or \`flowchart TD\` |
| Who calls whom, in what order, at runtime? | \`sequenceDiagram\` |
| What tables and columns change? | \`erDiagram\` |
| What are the states, and what moves between them? | \`stateDiagram-v2\` |
| What is the shape of the types or classes? | \`classDiagram\` |
| What order does the work happen in? | \`gantt\` |
| How do the branches split and merge? | \`gitGraph\` |
| Where does the user feel friction? | \`journey\` |
| What is in scope, broken down? | \`mindmap\` |
| What happened when? | \`timeline\` |
| Which option is worth it? | \`quadrantChart\` |
| What are the boxes in the deployed system? | \`architecture-beta\` or \`C4Context\` |
| What is the fixed layout of the parts? | \`block-beta\` |
| Which test proves which requirement? | \`requirementDiagram\` |
| Where does the volume or effort go? | \`sankey-beta\`, \`pie\`, \`treemap-beta\` |
| How did the number move? | \`xychart-beta\` |`;

const DIAGRAM_RULES = `- Pick the type from the question the reader asks, never from the data you hold.
- One diagram answers one question. If its heading needs the word "and", split it.
- Keep each diagram under 15 nodes. Two small diagrams beat one crowded one.
- Give a node a short id and a full label: \`ui[Kanban.tsx]\`, not \`KanbanTsx\`.
- Quote any label holding \`(\`, \`)\`, \`,\`, \`:\` or \`#\` — \`a["plan(taskId)"]\`.
- Never use \`end\` as a node id, and never start an id with \`o\` or \`x\`.
- Label every branch out of a decision: \`-->|yes|\` and \`-->|no|\`.
- Put a comment on its own line. A \`%%\` after code is a parse error.
- Group with \`subgraph name[Label]\` to show a layer or a boundary.
- The page renders on a dark canvas. Do not hardcode a \`fill:\` without a
  matching \`color:\`, or the text disappears.
- Every diagram goes in its own \`\`\`mermaid fence.`;

const PLAN_SHAPE = `# <task title>

## Overview
Two or three sentences. What changes, and why it is worth doing.

## Today
How the code behaves now, and where that falls short. Skip this heading only
when the task builds something that does not exist yet.

## Architecture
The required diagram: a \`flowchart\` with one subgraph per layer you touch —
UI, API, DB. Node labels are file paths or table names, not prose.

## <one heading per further diagram>
One to three more diagrams. Choose the type from the menu by what this task
actually is. Write the heading as the question the diagram answers, for
example "How a plan run reaches the database" or "Which states a task moves
through". Put a sentence before each diagram saying what to look at.

## Goal
Three to six lines. What must be true for this task to count as done, written so
a referee can check each line by running something. Name the real command or
test. Put a number and a baseline on anything about speed, size or coverage —
"30% faster than main on the bench command", not "faster". Say what must not break.

## Changes
### UI
- \`path/to/file.tsx\` — what changes
### API
- \`path/to/route.ts\` — what changes
### DB
- \`table_name\` — columns added or changed, and the migration needed

Drop a subheading entirely when that layer is untouched.

## Steps
1. Ordered, each step small enough to verify on its own.

## Risks
- What could break, and the check that would catch it.`;

/** Claude Code `--print --output-format json` wraps the answer in `.result`. */
export function extractText(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.result === 'string') return parsed.result.trim();
  } catch {
    // Not JSON (gemini adapter, or a crash before the JSON envelope) — take it raw.
  }
  return raw.trim();
}

/** The lines under one `## Heading`, up to the next heading. Fenced code is kept. */
export function extractSection(planDoc: string, heading: string): string {
  const lines: string[] = [];
  let inSection = false;
  for (const line of planDoc.split('\n')) {
    if (/^##\s+/.test(line)) {
      inSection = new RegExp(`^##\\s+${heading}\\s*$`, 'i').test(line);
      continue;
    }
    if (inSection) lines.push(line);
  }
  return lines.join('\n').trim();
}

/**
 * Pulls the numbered items under `## Steps` out of a plan, so a fresh plan can
 * seed the checklist. Stops at the next heading; ignores fenced code.
 */
export function extractSteps(planDoc: string): string[] {
  const steps: string[] = [];
  let inSection = false;
  let inFence = false;

  for (const line of planDoc.split('\n')) {
    // Track fences across the whole document so the toggle stays balanced.
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;

    if (/^##\s+/.test(line)) {
      inSection = /^##\s+Steps\s*$/i.test(line);
      continue;
    }
    if (!inSection) continue;

    const item = line.match(/^\s*\d+[.)]\s+(.*\S)/);
    if (item) steps.push(item[1].trim());
  }
  return steps;
}

/** Agents like to wrap a whole document in a ```markdown fence. Unwrap it. */
export function unwrapMarkdown(text: string): string {
  const match = text.match(/^```(?:markdown|md)?\n([\s\S]*)\n```$/);
  return match ? match[1].trim() : text;
}

export function buildPlanPrompt(task: { title: string; description?: string | null }): string {
  return [
    'You are the planner for one Kanban issue. Read the repository first, then',
    'write the implementation plan as a document. Change no file — you are',
    'planning, not building.',
    '',
    `Issue: ${task.title}`,
    task.description ? `Details: ${task.description}` : '',
    '',
    'Ground every claim in the code you actually read. Name real paths, real',
    'symbols, real tables. Where you are guessing, say so in Risks rather than',
    'stating it as fact.',
    '',
    'Tell the change as a story, and let the diagrams carry the beats. A reader',
    'should follow what exists now, what will exist after, and how the pieces',
    'move — without reading the prose twice. Choose each diagram for the',
    'question it answers:',
    '',
    DIAGRAM_MENU,
    '',
    'Diagram rules — a diagram that fails to parse is worse than no diagram:',
    DIAGRAM_RULES,
    '',
    'Use two to four diagrams in total. The architecture flowchart is always one',
    'of them. Add a second and third only when the task genuinely raises that',
    'question: a schema change earns an erDiagram, a new request path earns a',
    'sequenceDiagram, a lifecycle change earns a stateDiagram-v2, a vague or',
    'large task earns a mindmap of the scope. A one-line copy fix earns one',
    'diagram and nothing more.',
    '',
    'The Goal section is what a referee agent will later check to decide whether the',
    'work is done, so write it as conditions that can be measured, not as intentions.',
    '',
    'Reply with the markdown document only — no preamble, no closing remark.',
    'Follow this shape:',
    '',
    PLAN_SHAPE,
  ].filter(Boolean).join('\n');
}

export interface ChecklistItem { text: string; done: boolean }

export function parseChecklist(raw?: string | null): ChecklistItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderChecklist(items: ChecklistItem[]): string {
  return items.map((it, i) => `${i}. [${it.done ? 'x' : ' '}] ${it.text}`).join('\n');
}

/**
 * The briefing every agent working a Kanban task gets, in the background or in
 * an interactive session. It tells the agent where it is, that the board is the
 * shared record, and which MCP tools write back to it.
 */
export function buildTaskBriefing(task: {
  id: string;
  title: string;
  description?: string | null;
  checklist?: string | null;
  projectName?: string | null;
  goal?: string | null;
}): string {
  const items = parseChecklist(task.checklist);

  return [
    'This is a Remote Agent task. It came off a Kanban board, and the board is',
    'the shared record between you and the person who filed it — keep it true.',
    '',
    `Task id: ${task.id}`,
    `Title: ${task.title}`,
    task.projectName ? `Project: ${task.projectName}` : '',
    task.description ? `Details: ${task.description}` : '',
    '',
    items.length
      ? [
          'Checklist — tick each item the moment it is really done, not at the end:',
          renderChecklist(items),
          '',
          'Tick item N with the remote-agent MCP tool `check_item`',
          `({ taskId: "${task.id}", index: N, done: true }). The index is the number above.`,
          'Never tick an item you have not verified. If an item turns out to be wrong',
          'or unnecessary, leave it and say why in your report.',
        ].join('\n')
      : [
          'This task has no checklist. If the work splits into three or more steps,',
          'create one first with the remote-agent MCP tool `set_checklist`',
          `({ taskId: "${task.id}", items: [{ text: "..." }, ...] }), then tick items`,
          'off with `check_item` as you go.',
        ].join('\n'),
    '',
    'Report progress as you work — do not go silent and surface only at the end.',
    'Use the remote-agent MCP tools: `comment_task` to post a note on the task,',
    '`update_task` to move its status, `get_task` to re-read it if you lose context.',
    'Post a comment when you finish a meaningful chunk, and when you hit something',
    'that changes the plan.',
    '',
    'The board moves the task to In Progress while you run, and to Review Needed',
    'when you finish. If the change cannot be judged by reading the diff — it needs',
    'someone to click through it, watch it in a browser, or exercise a device —',
    `move it to Manual Testing instead with \`update_task\` ({ taskId: "${task.id}",`,
    'taskPatch: { status: "manual_testing" } }), and say in your report what to try.',
    '',
    ...verifyLines(task),
  ].filter(Boolean).join('\n');
}

/** The loop rules an agent must know. The UI copy lives in ui/src/lib/task-prompt.ts. */
function verifyLines(task: { id: string; goal?: string | null }): string[] {
  return [
    task.goal
      ? ['The goal this task is judged against:', '', task.goal, '',
         'When you stop, a referee agent runs commands of its own and decides whether the goal is met. Check it yourself first — its verdict comes back to you if it fails.'].join('\n')
      : '',
    `When you open a pull request, save its URL with \`update_task\` ({ taskId: "${task.id}", taskPatch: { prUrl: "..." } }).`,
  ];
}

export function buildExecutePrompt(task: {
  id: string;
  title: string;
  planDoc: string;
  description?: string | null;
  checklist?: string | null;
  projectName?: string | null;
  goal?: string | null;
}, feedback?: string): string {
  return [
    buildTaskBriefing(task),
    '',
    'You are the executor. The plan below was written for this repository by the',
    'planner. Implement it. Keep to the files the plan names — if the plan is',
    'wrong, say so in a comment rather than quietly building something else.',
    '',
    '--- PLAN ---',
    task.planDoc,
    '--- END PLAN ---',
    '',
    feedback ? `A previous run already worked on this task. Continue from the current code.\n\n--- FEEDBACK ---\n${feedback}\n--- END FEEDBACK ---\n` : '',
    'When you finish, reply with a short markdown report only: what you changed,',
    'the files you touched as a list, and one command that verifies it.',
  ].filter(Boolean).join('\n');
}

async function loadTask(taskId: string, userId: string) {
  const task = await kanbanRepository.findTaskById(taskId, userId);
  if (!task) throw new Error('Task not found');

  const project = await db.query.projects.findFirst({ where: eq(projects.id, task.projectId) });
  if (!project) throw new Error('Project not found');

  return { task, project };
}

/**
 * Where the board should sit while the executor runs. The column is the thing
 * a person glances at, so it has to follow the agent without being asked.
 * A failed run stays put — it is still in progress, and the failure shows in
 * the plan status and the result comment.
 */
export function statusForRun(phase: 'executing' | 'done' | 'failed'): string | null {
  if (phase === 'executing') return 'in_progress';
  if (phase === 'done') return 'review_needed';
  return null;
}

async function setPlanStatus(taskId: string, planStatus: PlanStatus, planDoc?: string) {
  await db.update(kanbanTasks)
    .set({ planStatus, ...(planDoc !== undefined ? { planDoc } : {}), updatedAt: new Date() })
    .where(eq(kanbanTasks.id, taskId));
}

/** Moves the column, and never fights a status the agent set for itself. */
async function moveColumn(taskId: string, status: string | null, only?: string[]) {
  if (!status) return;
  if (only) {
    const current = await db.query.kanbanTasks.findFirst({
      where: eq(kanbanTasks.id, taskId),
      columns: { status: true },
    });
    if (current && !only.includes(current.status)) return;
  }
  await db.update(kanbanTasks)
    .set({ status: status as never, updatedAt: new Date() })
    .where(eq(kanbanTasks.id, taskId));
}

class AgentPlanService {
  // ponytail: one in-flight run per task, tracked in memory. A single API process
  // owns its spawned agents; move to a DB lease if the API ever runs multi-node.
  private running = new Set<string>();

  isRunning(taskId: string): boolean {
    return this.running.has(taskId);
  }

  /** Plan phase — the agent reads the repo and writes the plan document. */
  async plan(taskId: string, userId: string) {
    const { task, project } = await loadTask(taskId, userId);
    if (this.running.has(taskId)) throw new Error('An agent is already running on this task');

    await setPlanStatus(taskId, 'planning');
    this.spawn(taskId, {
      adapterType: task.adapterType || 'claude_code',
      projectPath: project.localPath,
      branch: task.branch || undefined,
      prompt: buildPlanPrompt(task),
      allowedTools: PLAN_TOOLS,
    }, async (text, ok) => {
      if (!ok) return setPlanStatus(taskId, 'failed');
      const planDoc = unwrapMarkdown(text);
      await setPlanStatus(taskId, 'ready', planDoc);

      // Seed the goal from the plan, unless the task already carries one.
      if (!task.goal) {
        const goal = extractSection(planDoc, 'Goal');
        if (goal) await kanbanService.updateTask(taskId, userId, { goal });
      }

      // Seed the checklist from the plan's steps, but never overwrite one the
      // person (or a previous run) already curated.
      if (!parseChecklist(task.checklist).length) {
        const steps = extractSteps(planDoc);
        if (steps.length) {
          await kanbanService.setChecklist(taskId, userId, steps.map(text => ({ text })));
        }
      }
    });

    return kanbanRepository.findTaskById(taskId, userId);
  }

  /**
   * Execute phase — the same agent, now handed its own plan. `feedback` is a
   * follow-up round from the task loop: verify output or review comments.
   */
  async execute(taskId: string, userId: string, feedback?: string) {
    const { task, project } = await loadTask(taskId, userId);
    if (this.running.has(taskId)) throw new Error('An agent is already running on this task');
    // A follow-up round can run on the description alone: the first run may
    // have come from auto-flow, which never wrote a plan.
    const planDoc = task.planDoc || (feedback ? task.description || task.title : null);
    if (!planDoc) throw new Error('No plan yet — generate a plan first');
    taskLoopService.markWorking(taskId);

    await setPlanStatus(taskId, 'executing');
    // The column follows the run: anything not already finished moves to
    // In Progress the moment the agent starts.
    await moveColumn(taskId, statusForRun('executing'), ['backlog', 'todo', 'manual_testing', 'review_needed']);

    this.spawn(taskId, {
      adapterType: task.adapterType || 'claude_code',
      projectPath: project.localPath,
      branch: task.branch || undefined,
      prompt: buildExecutePrompt({
        id: task.id,
        title: task.title,
        planDoc,
        description: task.description,
        checklist: task.checklist,
        projectName: project.name,
        goal: task.goal,
      }, feedback),
      allowedTools: EXECUTE_TOOLS,
    }, async (text, ok) => {
      await kanbanRepository.createComment({
        taskId,
        userId,
        content: unwrapMarkdown(text),
        kind: 'result',
      });
      await setPlanStatus(taskId, ok ? 'done' : 'failed');
      // A failed run stays put. A finished one goes through the task loop,
      // which moves it only if it is still In Progress and passes verify.
      if (ok) await taskLoopService.onAgentDone(taskId, userId);
    });

    return kanbanRepository.findTaskById(taskId, userId);
  }

  /** Runs the CLI adapter off the request path; the UI polls planStatus. */
  private spawn(
    taskId: string,
    config: { adapterType: string; projectPath: string; branch?: string; prompt: string; allowedTools: string[] },
    onDone: (text: string, ok: boolean) => Promise<void>,
  ) {
    const adapter = cliAdapterRegistry.get(config.adapterType);
    if (!adapter) {
      void setPlanStatus(taskId, 'failed');
      return;
    }

    this.running.add(taskId);
    (async () => {
      // Once the slot is free, onDone may have started the next round on this
      // task. Touch neither the slot nor the status after that: both belong to
      // the new run.
      let handedOver = false;
      try {
        const result = await adapter.startSession({
          projectPath: config.projectPath,
          branch: config.branch,
          prompt: config.prompt,
          allowedTools: config.allowedTools,
        });
        this.running.delete(taskId);
        handedOver = true;
        await onDone(extractText(result.output), result.success);
      } catch (error) {
        console.error(`[agent-plan] Task ${taskId} failed:`, error);
        if (!handedOver) await setPlanStatus(taskId, 'failed').catch(() => {});
      } finally {
        if (!handedOver) this.running.delete(taskId);
      }
    })();
  }
}

export const agentPlanService = new AgentPlanService();
