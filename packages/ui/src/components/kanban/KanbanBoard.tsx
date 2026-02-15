import { useState, useCallback } from 'react';
import { KanbanColumn } from './KanbanColumn';
import type { KanbanTask, KanbanBoardData, KanbanStatus } from '@/lib/api';

interface KanbanBoardProps {
  data: KanbanBoardData;
  projectId?: string;
  onTaskClick: (task: KanbanTask) => void;
  onMoveTask: (taskId: string, status: KanbanStatus, position: number) => void;
  onQuickAdd: (title: string, status: KanbanStatus) => void;
}

export function KanbanBoard({ data, onTaskClick, onMoveTask, onQuickAdd }: KanbanBoardProps) {
  const [draggedTask, setDraggedTask] = useState<KanbanTask | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, task: KanbanTask) => {
    setDraggedTask(task);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.id);
    // Make the drag image slightly transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
      setTimeout(() => {
        if (e.currentTarget instanceof HTMLElement) {
          e.currentTarget.style.opacity = '1';
        }
      }, 0);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetStatus: KanbanStatus) => {
    e.preventDefault();
    if (!draggedTask) return;

    // Calculate position (add to end of column)
    const targetColumn = data.columns.find(c => c.id === targetStatus);
    const newPosition = (targetColumn?.tasks.length || 0) + 1;

    if (draggedTask.status !== targetStatus || true) {
      onMoveTask(draggedTask.id, targetStatus, newPosition);
    }

    setDraggedTask(null);
    setDragOverColumn(null);
  }, [draggedTask, data.columns, onMoveTask]);

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 h-full">
      {data.columns.map((column) => (
        <KanbanColumn
          key={column.id}
          column={column}
          onTaskClick={onTaskClick}
          onDragStart={handleDragStart}
          onDragOver={(e) => {
            handleDragOver(e);
            setDragOverColumn(column.id);
          }}
          onDrop={handleDrop}
          onQuickAdd={onQuickAdd}
          isDragOver={dragOverColumn === column.id && draggedTask?.status !== column.id}
        />
      ))}
    </div>
  );
}
