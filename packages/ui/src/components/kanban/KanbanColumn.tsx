import { useState, useRef } from 'react';
import { Plus, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { KanbanCard } from './KanbanCard';
import type { KanbanTask, KanbanColumn as KanbanColumnType, KanbanStatus } from '@/lib/api';

const columnColors: Record<string, string> = {
  backlog: 'border-t-gray-400',
  todo: 'border-t-blue-400',
  in_progress: 'border-t-yellow-400',
  manual_testing: 'border-t-orange-400',
  review_needed: 'border-t-purple-400',
  completed: 'border-t-green-400',
};

const columnBgColors: Record<string, string> = {
  backlog: 'bg-gray-50/50 dark:bg-gray-900/20',
  todo: 'bg-blue-50/50 dark:bg-blue-900/10',
  in_progress: 'bg-yellow-50/50 dark:bg-yellow-900/10',
  manual_testing: 'bg-orange-50/50 dark:bg-orange-900/10',
  review_needed: 'bg-purple-50/50 dark:bg-purple-900/10',
  completed: 'bg-green-50/50 dark:bg-green-900/10',
};

interface KanbanColumnProps {
  column: KanbanColumnType;
  onTaskClick: (task: KanbanTask) => void;
  onDragStart: (e: React.DragEvent, task: KanbanTask) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, status: KanbanStatus) => void;
  onQuickAdd: (title: string, status: KanbanStatus) => void;
  isDragOver: boolean;
}

export function KanbanColumn({
  column,
  onTaskClick,
  onDragStart,
  onDragOver,
  onDrop,
  onQuickAdd,
  isDragOver,
}: KanbanColumnProps) {
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

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
      className={cn(
        'flex flex-col min-w-[300px] max-w-[340px] w-[320px] rounded-xl border border-t-4',
        columnColors[column.id],
        columnBgColors[column.id],
        isDragOver && 'ring-2 ring-primary/30 border-primary/50',
        'transition-all duration-150',
      )}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(e);
      }}
      onDrop={(e) => onDrop(e, column.id)}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between p-3 pb-2">
        <div className="flex items-center gap-2">
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
      <div className="flex-1 overflow-y-auto p-2 pt-0 space-y-2 min-h-[100px]">
        {column.tasks.map((task) => (
          <KanbanCard
            key={task.id}
            task={task}
            onClick={onTaskClick}
            onDragStart={onDragStart}
          />
        ))}

        {/* Drop zone indicator */}
        {isDragOver && column.tasks.length === 0 && (
          <div className="flex items-center justify-center h-20 rounded-lg border-2 border-dashed border-primary/30 text-muted-foreground text-sm">
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
