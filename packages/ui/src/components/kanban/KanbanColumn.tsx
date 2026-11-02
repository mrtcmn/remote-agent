import { useState, useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { SortableCard } from './SortableCard';
import type { KanbanTask, KanbanColumn as KanbanColumnType, KanbanStatus } from '@/lib/api';
import type { SessionLive } from '@/lib/task-live';
import type { TaskMenuHandlers } from './TaskContextMenu';

// Each state owns a tint: a stronger strip with the vertical label, a faint wash behind the cards.
const statusTones: Record<string, { strip: string; area: string; text: string }> = {
  backlog: { strip: 'bg-zinc-500/15', area: 'bg-zinc-500/[0.03]', text: 'text-zinc-400' },
  todo: { strip: 'bg-blue-400/15', area: 'bg-blue-400/[0.03]', text: 'text-blue-400' },
  in_progress: { strip: 'bg-yellow-400/15', area: 'bg-yellow-400/[0.03]', text: 'text-yellow-400' },
  manual_testing: { strip: 'bg-orange-400/15', area: 'bg-orange-400/[0.03]', text: 'text-orange-400' },
  review_needed: { strip: 'bg-purple-400/15', area: 'bg-purple-400/[0.03]', text: 'text-purple-400' },
  completed: { strip: 'bg-green-400/15', area: 'bg-green-400/[0.03]', text: 'text-green-400' },
};

interface KanbanColumnProps {
  column: KanbanColumnType;
  onTaskClick: (task: KanbanTask) => void;
  onQuickAdd: (title: string, status: KanbanStatus) => void;
  showProject?: boolean;
  live: Map<string, SessionLive>;
  menu: TaskMenuHandlers;
  draggingId: string | null;
}

export function KanbanColumn({
  column,
  onTaskClick,
  onQuickAdd,
  showProject,
  live,
  menu,
  draggingId,
}: KanbanColumnProps) {
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // The column is a drop target of its own, so an empty one still takes a card.
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const isTarget = draggingId !== null && (isOver || column.tasks.some(t => t.id === draggingId));
  const tone = statusTones[column.id] ?? statusTones.backlog;
  const active = column.tasks.filter(t => t.sessionId && live.get(t.sessionId)?.agent === 'working').length;

  const handleAddTask = () => {
    if (newTaskTitle.trim()) {
      onQuickAdd(newTaskTitle.trim(), column.id);
      setNewTaskTitle('');
      setIsAddingTask(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAddTask();
    if (e.key === 'Escape') {
      setNewTaskTitle('');
      setIsAddingTask(false);
    }
  };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-[320px] shrink-0 border-r last:border-r-0 transition-colors duration-150',
        tone.area,
        isTarget && 'bg-primary/5',
      )}
    >
      {/* Vertical status strip: name, count, active, add */}
      <div className={cn('flex flex-col items-center gap-2 w-8 shrink-0 py-2', tone.strip, tone.text)}>
        <button
          type="button"
          title="Add task"
          className="flex items-center justify-center size-6 rounded-md hover:bg-foreground/10"
          onClick={() => {
            setIsAddingTask(true);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
        >
          <Plus className="size-3.5" />
        </button>
        <span className="text-[11px] font-semibold tabular-nums">{column.count}</span>
        {active > 0 && (
          <span title={`${active} active`} className="flex items-center gap-1 text-[10px] font-medium tabular-nums">
            <span className="size-1.5 rounded-full bg-current animate-pulse" />
            {active}
          </span>
        )}
        <h3 className="[writing-mode:vertical-rl] rotate-180 text-[11px] font-semibold uppercase tracking-[0.15em] whitespace-nowrap">
          {column.title}
        </h3>
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
      {/* Cards */}
      <div className="flex-1 flex flex-col gap-1.5 overflow-y-auto overflow-x-hidden p-2 min-h-[100px]">
        <SortableContext items={column.tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {column.tasks.map((task) => (
            <SortableCard
              key={task.id}
              task={task}
              onClick={onTaskClick}
              showProject={showProject}
              live={task.sessionId ? live.get(task.sessionId) : undefined}
              menu={menu}
            />
          ))}
        </SortableContext>

        {/* An empty column needs something to aim at */}
        {column.tasks.length === 0 && (
          <div className={cn(
            'flex items-center justify-center h-20 rounded-lg border-2 border-dashed text-sm transition-colors',
            isTarget ? 'border-primary/40 text-primary' : 'border-transparent text-transparent',
          )}>
            Drop here
          </div>
        )}
      </div>

      {/* Quick Add */}
      {isAddingTask && (
        <div className="p-2 pt-0">
          <div className="p-2 rounded-lg border bg-card">
            <Input
              ref={inputRef}
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                if (!newTaskTitle.trim()) setIsAddingTask(false);
              }}
              placeholder="Task title..."
              className="text-sm h-8 mb-2"
            />
            <div className="flex gap-1">
              <Button size="sm" className="h-7 text-xs" onClick={handleAddTask}>
                Add
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => { setIsAddingTask(false); setNewTaskTitle(''); }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
