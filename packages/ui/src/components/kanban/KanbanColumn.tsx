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

// Linear-style: a neutral column, one coloured dot to name the state.
const statusDots: Record<string, string> = {
  backlog: 'bg-zinc-500',
  todo: 'bg-blue-400',
  in_progress: 'bg-yellow-400',
  manual_testing: 'bg-orange-400',
  review_needed: 'bg-purple-400',
  completed: 'bg-green-400',
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
        'flex flex-col min-w-[300px] max-w-[340px] w-[320px] rounded-xl border bg-card/40',
        isTarget && 'ring-2 ring-primary/30 border-primary/50',
        'transition-all duration-150',
      )}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between px-2.5 py-2">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', statusDots[column.id])} />
          <h3 className="font-semibold text-sm">{column.title}</h3>
          <span className="flex items-center justify-center h-5 min-w-[20px] px-1.5 text-[11px] font-medium rounded-full bg-muted text-muted-foreground">
            {column.count}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            setIsAddingTask(true);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Cards */}
      <div className="flex-1 flex flex-col gap-1.5 overflow-y-auto overflow-x-hidden px-2 pb-2 min-h-[100px]">
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
  );
}
