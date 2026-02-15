import {
  GripVertical, MessageSquare, Paperclip, GitBranch, AlertTriangle,
  Bot, User as UserIcon, Clock, ChevronRight, Link2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KanbanTask } from '@/lib/api';

const priorityColors: Record<string, string> = {
  critical: 'border-l-red-500 bg-red-500/5',
  high: 'border-l-orange-500 bg-orange-500/5',
  medium: 'border-l-blue-500',
  low: 'border-l-gray-400',
};

const priorityBadgeColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  low: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const assigneeIcons: Record<string, React.ReactNode> = {
  agent: <Bot className="h-3.5 w-3.5" />,
  user: <UserIcon className="h-3.5 w-3.5" />,
};

interface KanbanCardProps {
  task: KanbanTask;
  onClick: (task: KanbanTask) => void;
  onDragStart: (e: React.DragEvent, task: KanbanTask) => void;
}

export function KanbanCard({ task, onClick, onDragStart }: KanbanCardProps) {
  const labels = task.labels ? JSON.parse(task.labels) as string[] : [];
  const commentCount = task.comments?.length || 0;
  const attachmentCount = task.attachments?.length || 0;
  const subtaskCount = task.subtasks?.length || 0;
  const completedSubtasks = task.subtasks?.filter(s => s.status === 'completed').length || 0;
  const isBlocked = task.dependencies?.some(d => d.dependsOn && d.dependsOn.status !== 'completed');

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task)}
      onClick={() => onClick(task)}
      className={cn(
        'group relative p-3 rounded-lg border border-l-4 bg-card cursor-pointer',
        'hover:shadow-md hover:border-primary/30 transition-all duration-150',
        'active:shadow-sm active:scale-[0.98]',
        priorityColors[task.priority],
        isBlocked && 'opacity-70',
      )}
    >
      {/* Drag handle */}
      <div className="absolute left-0.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-40 transition-opacity">
        <GripVertical className="h-4 w-4" />
      </div>

      {/* Blocked indicator */}
      {isBlocked && (
        <div className="flex items-center gap-1 text-amber-500 text-xs mb-1.5">
          <AlertTriangle className="h-3 w-3" />
          <span>Blocked</span>
        </div>
      )}

      {/* Title */}
      <h4 className="text-sm font-medium leading-snug pr-2 mb-1">{task.title}</h4>

      {/* Labels */}
      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {labels.map((label, i) => (
            <span
              key={i}
              className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-primary/10 text-primary"
            >
              {label}
            </span>
          ))}
        </div>
      )}

      {/* Metadata row */}
      <div className="flex items-center gap-2 flex-wrap mt-2">
        {/* Priority badge */}
        <span className={cn('px-1.5 py-0.5 text-[10px] font-semibold rounded', priorityBadgeColors[task.priority])}>
          {task.priority.toUpperCase()}
        </span>

        {/* Assignee */}
        {task.assigneeType !== 'unassigned' && (
          <span className={cn(
            'flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded',
            task.assigneeType === 'agent'
              ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
              : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
          )}>
            {assigneeIcons[task.assigneeType]}
            {task.assigneeType === 'agent' ? 'Agent' : 'User'}
          </span>
        )}

        {/* Auto-flow indicator */}
        {task.autoFlow && (
          <span className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
            <ChevronRight className="h-3 w-3" />
            Auto
          </span>
        )}

        {/* Branch */}
        {task.branch && (
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
            <GitBranch className="h-3 w-3" />
            <span className="truncate max-w-[80px]">{task.branch}</span>
          </span>
        )}

        {/* GitHub link */}
        {task.githubIssueUrl && (
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
            <Link2 className="h-3 w-3" />
            #{task.githubIssueNumber}
          </span>
        )}
      </div>

      {/* Footer stats */}
      <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border/50">
        {subtaskCount > 0 && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-green-500 transition-all"
                style={{ width: `${subtaskCount > 0 ? (completedSubtasks / subtaskCount) * 100 : 0}%` }}
              />
            </div>
            {completedSubtasks}/{subtaskCount}
          </span>
        )}
        {commentCount > 0 && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <MessageSquare className="h-3 w-3" />
            {commentCount}
          </span>
        )}
        {attachmentCount > 0 && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Paperclip className="h-3 w-3" />
            {attachmentCount}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {new Date(task.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </span>
      </div>
    </div>
  );
}
