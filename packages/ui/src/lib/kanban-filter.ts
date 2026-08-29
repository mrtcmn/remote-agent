import type {
  AssigneeType, KanbanBoardData, KanbanPriority, KanbanStatus, KanbanTask,
} from '@/lib/api';

export interface BoardFilters {
  status: KanbanStatus[];
  priority: KanbanPriority[];
  assignee?: AssigneeType;
  search: string;
}

function matches(task: KanbanTask, filters: BoardFilters): boolean {
  if (filters.priority.length > 0 && !filters.priority.includes(task.priority)) return false;
  if (filters.assignee && task.assigneeType !== filters.assignee) return false;

  const search = filters.search.trim().toLowerCase();
  if (search) {
    const haystack = `${task.title} ${task.description || ''}`.toLowerCase();
    if (!haystack.includes(search)) return false;
  }

  return true;
}

/**
 * Applies the board filters. An empty status list keeps every column; the count
 * always reports the cards the column actually shows.
 */
export function filterBoard(board: KanbanBoardData, filters: BoardFilters): KanbanBoardData {
  return {
    columns: board.columns
      .filter((col) => filters.status.length === 0 || filters.status.includes(col.id))
      .map((col) => {
        const tasks = col.tasks.filter((task) => matches(task, filters));
        return { ...col, tasks, count: tasks.length };
      }),
  };
}
