import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { KanbanCard } from './KanbanCard';
import type { SessionLive } from '@/lib/task-live';
import type { TaskMenuHandlers } from './TaskContextMenu';
import type { KanbanTask } from '@/lib/api';

/**
 * One card in the sortable list. dnd-kit moves the neighbours with a transform
 * while a card travels, so the gap opens under the pointer and the GPU does the
 * work. The card being dragged stays in place as a faint outline; the copy that
 * follows the pointer is the board's DragOverlay.
 */
export function SortableCard({
  task,
  onClick,
  showProject,
  live,
  menu,
}: {
  task: KanbanTask;
  onClick: (task: KanbanTask) => void;
  showProject?: boolean;
  live?: SessionLive;
  menu: TaskMenuHandlers;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { status: task.status },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        willChange: 'transform',
      }}
      {...attributes}
      {...listeners}
    >
      <KanbanCard task={task} onClick={onClick} showProject={showProject} live={live} menu={menu} />
    </div>
  );
}
