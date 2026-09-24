import type { ChecklistItem, KanbanTask } from '@/lib/api';

export function parseChecklist(raw: string | null | undefined): ChecklistItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * The prompt that opens an interactive session on a task. It mirrors the
 * briefing the background executor gets, so a session and a background run
 * behave the same way towards the board.
 */
export function buildSessionPrompt(task: KanbanTask): string {
  const items = parseChecklist(task.checklist);

  return [
    'This is a Remote Agent task, taken from the Kanban board. The board is the',
    'shared record — keep it true as you work.',
    '',
    `Task id: ${task.id}`,
    `Title: ${task.title}`,
    task.project?.name ? `Project: ${task.project.name}` : '',
    task.description ? `\nDetails:\n${task.description}` : '',
    task.planDoc ? `\n--- PLAN ---\n${task.planDoc}\n--- END PLAN ---` : '',
    items.length
      ? [
          '',
          'Checklist — tick each item when it is really done:',
          ...items.map((it, i) => `${i}. [${it.done ? 'x' : ' '}] ${it.text}`),
          '',
          `Tick item N with the remote-agent MCP tool \`check_item\` ({ taskId: "${task.id}", index: N, done: true }).`,
        ].join('\n')
      : [
          '',
          'This task has no checklist. If the work splits into three or more steps,',
          `create one with the remote-agent MCP tool \`set_checklist\` ({ taskId: "${task.id}", items: [...] }).`,
        ].join('\n'),
    '',
    'Report progress with the remote-agent MCP tools: `comment_task` to post a',
    'note, `update_task` to move the status, `get_task` to re-read the task.',
    task.goal
      ? `\nThe goal this task is judged against:\n\n${task.goal}\n\nWhen you stop, a referee agent runs commands of its own and decides whether the goal is met. Check it yourself first — its verdict comes back to you if it fails.`
      : '',
    `When you open a pull request, save its URL with \`update_task\` ({ taskId: "${task.id}", taskPatch: { prUrl: "..." } }).`,
    '',
    task.planDoc
      ? 'Start by confirming the plan still matches the code, then implement it.'
      : 'Start by reading the relevant code, then say what you intend to do before you change anything.',
  ].filter(Boolean).join('\n');
}
