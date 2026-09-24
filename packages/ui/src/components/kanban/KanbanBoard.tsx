import { useEffect, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin,
  useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { useSessionLive } from '@/hooks/useKanban';
import type { TaskMenuHandlers } from './TaskContextMenu';
import type { KanbanTask, KanbanBoardData, KanbanStatus } from '@/lib/api';

interface KanbanBoardProps {
  data: KanbanBoardData;
  projectId?: string;
  onTaskClick: (task: KanbanTask) => void;
  /** `afterId` is the card the drop landed under, so a filtered board still maps
   * onto the real column. Null means the top of the column. */
  onMoveTask: (taskId: string, status: KanbanStatus, position: number, afterId: string | null) => void;
  onQuickAdd: (title: string, status: KanbanStatus) => void;
  menu: TaskMenuHandlers;
}

/** Which column a card sits in right now, or the column itself when the id is a column. */
function columnOf(board: KanbanBoardData, id: string): KanbanStatus | null {
  if (board.columns.some(c => c.id === id)) return id as KanbanStatus;
  return board.columns.find(c => c.tasks.some(t => t.id === id))?.id ?? null;
}

function findTask(board: KanbanBoardData, id: string): KanbanTask | null {
  for (const column of board.columns) {
    const task = column.tasks.find(t => t.id === id);
    if (task) return task;
  }
  return null;
}

/** Puts a task into one column at one index, and takes it out of every other. */
function place(board: KanbanBoardData, task: KanbanTask, status: KanbanStatus, index: number): KanbanBoardData {
  const columns = board.columns.map(column => {
    const tasks = column.tasks.filter(t => t.id !== task.id);
    if (column.id === status) tasks.splice(Math.max(0, Math.min(index, tasks.length)), 0, { ...task, status });
    return { ...column, tasks, count: tasks.length };
  });
  return { columns };
}

export function KanbanBoard({ data, projectId, onTaskClick, onMoveTask, onQuickAdd, menu }: KanbanBoardProps) {
  // With one project filtered in, the name on every card is noise. Across all
  // projects it is the only way to tell whose task this is.
  const showProject = !projectId;
  const live = useSessionLive();

  // The board the user sees. While a card is in the air, and until the server
  // has the move, this is the local arrangement rather than the fetched one —
  // otherwise the next poll would snap the card back to where it came from.
  const [board, setBoard] = useState(data);
  const [dragging, setDragging] = useState<KanbanTask | null>(null);
  // Set right after a drop, cleared once the write and its refetch have had time
  // to land. ponytail: a timer, not a per-card reconciliation — the board polls
  // every 10s, so the window only has to outlive one mutation.
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (dragging || holding) return;
    setBoard(data);
  }, [data, dragging, holding]);

  useEffect(() => () => clearTimeout(holdTimer.current), []);

  const hold = () => {
    setHolding(true);
    clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => setHolding(false), 1500);
  };

  const sensors = useSensors(
    // A card travels only after 6px, so a plain click still opens the task.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setDragging(findTask(board, String(event.active.id)));
  };

  /** The gap follows the pointer: the card moves in the local board as it travels. */
  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const task = findTask(board, String(active.id));
    const target = columnOf(board, String(over.id));
    if (!task || !target) return;

    const column = board.columns.find(c => c.id === target)!;
    const overIndex = column.tasks.findIndex(t => t.id === over.id);
    const from = columnOf(board, String(active.id));

    if (from === target) {
      const oldIndex = column.tasks.findIndex(t => t.id === active.id);
      if (overIndex === -1 || oldIndex === overIndex) return;
      setBoard({
        columns: board.columns.map(c =>
          c.id === target ? { ...c, tasks: arrayMove(c.tasks, oldIndex, overIndex) } : c),
      });
      return;
    }

    // Over the column itself, rather than a card in it, means the end of it.
    setBoard(place(board, task, target, overIndex === -1 ? column.tasks.length : overIndex));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const task = dragging;
    setDragging(null);
    if (!task || !over) return;

    const target = columnOf(board, String(over.id));
    if (!target) return;

    const column = board.columns.find(c => c.id === target)!.tasks;
    const index = column.findIndex(t => t.id === active.id);
    const wasAt = data.columns.find(c => c.id === target)?.tasks.findIndex(t => t.id === active.id) ?? -1;
    if (target === task.status && index === wasAt) return;

    hold();
    onMoveTask(task.id, target, Math.max(0, index), index > 0 ? column[index - 1].id : null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => { setDragging(null); setBoard(data); }}
    >
      <div className="flex gap-4 overflow-x-auto overflow-y-hidden pb-4 h-full">
        {board.columns.map((column) => (
          <KanbanColumn
            key={column.id}
            column={column}
            onTaskClick={onTaskClick}
            onQuickAdd={onQuickAdd}
            showProject={showProject}
            live={live}
            menu={menu}
            draggingId={dragging?.id ?? null}
          />
        ))}
      </div>

      {/* The card travels with the pointer instead of a browser drag image. */}
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
        {dragging && (
          <div className="rotate-[2deg] cursor-grabbing shadow-2xl">
            <KanbanCard
              task={dragging}
              onClick={() => {}}
              showProject={showProject}
              live={dragging.sessionId ? live.get(dragging.sessionId) : undefined}
              menu={menu}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
