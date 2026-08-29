import {
  GripVertical, MessageSquare, Paperclip, GitBranch, AlertTriangle,
  Bot, User as UserIcon, Clock, ChevronRight, Link2, FileText, Loader2, CheckSquare,
  FolderGit2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseChecklist } from '@/lib/task-prompt';
import type { KanbanTask } from '@/lib/api';

const priorityColors: Record<string, string> = {
  critical: 'border-l-red-500 bg-red-500/5',
  high: 'border-l-orange-500 bg-orange-500/5',
  medium: 'border-l-blue-500',
  low: 'border-l-gray-400',
};

const assigneeIcons: Record<string, React.ReactNode> = {
  agent: <Bot className="h-3.5 w-3.5" />,
  user: <UserIcon className="h-3.5 w-3.5" />,
};

interface KanbanCardProps {
  task: KanbanTask;
  onClick: (task: KanbanTask) => void;
  onDragStart: (e: React.DragEvent, task: KanbanTask) => void;
  /** Set when the board spans every project, so the card must name its own. */
  showProject?: boolean;
}

export function KanbanCard({ task, onClick, onDragStart, showProject }: KanbanCardProps) {
  const labels = task.labels ? JSON.parse(task.labels) as string[] : [];
  const checklist = parseChecklist(task.checklist);
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
        'group relative px-2.5 py-2 rounded-lg border border-l-[3px] bg-card cursor-pointer',
        'hover:shadow-md hover:border-primary/30 transition-all duration-150',
        'active:shadow-sm active:scale-[0.98]',
        priorityColors[task.priority],
        isBlocked && 'opacity-70',
      )}
      title={`${task.priority} priority`}
    >
      {/* Drag handle */}
      <div className="absolute left-0.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-40 transition-opacity">
        <GripVertical className="h-4 w-4" />
      </div>

      {/* Project and blocked share the top line — both are card-level context */}
      {(isBlocked || (showProject && task.project)) && (
        <div className="flex items-center gap-1.5 mb-0.5 text-[10px] font-medium text-muted-foreground">
          {isBlocked && (
            <span className="flex items-center gap-0.5 text-amber-500 shrink-0">
              <AlertTriangle className="h-3 w-3" />
              Blocked
            </span>
          )}
          {showProject && task.project && (
            <>
              <FolderGit2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{task.project.name}</span>
            </>
          )}
        </div>
      )}

      {/* Title */}
      <h4 className="text-[13px] font-medium leading-snug pr-2">{task.title}</h4>

      {/* Labels */}
      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {labels.map((label, i) => (
            <span
              key={i}
              className="px-1.5 py-px text-[10px] font-medium rounded-full bg-primary/10 text-primary"
            >
              {label}
            </span>
          ))}
        </div>
      )}

      {/* One meta row. Priority is not repeated here — the left border is it. */}
      <div className="flex items-center gap-x-2 gap-y-1 flex-wrap mt-1.5 text-[10px] text-muted-foreground">
        {/* Assignee — icon only; the colour carries agent vs person */}
        {task.assigneeType !== 'unassigned' && (
          <span
            className={cn(
              'shrink-0',
              task.assigneeType === 'agent' ? 'text-purple-400' : 'text-green-500',
            )}
            title={task.assigneeType === 'agent' ? 'Agent' : 'User'}
          >
            {assigneeIcons[task.assigneeType]}
          </span>
        )}

        {/* Agent plan — the only state worth a word */}
        {task.planStatus && task.planStatus !== 'none' && (
          <span className="flex items-center gap-1 text-primary shrink-0">
            {task.planStatus === 'planning' || task.planStatus === 'executing'
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <FileText className="h-3 w-3" />}
            {task.planStatus === 'ready' ? 'Plan' : task.planStatus}
          </span>
        )}

        {task.autoFlow && (
          <span className="flex items-center text-violet-400 shrink-0" title="Auto-flow">
            <ChevronRight className="h-3 w-3" />
          </span>
        )}

        {checklist.length > 0 && (
          <span className="flex items-center gap-1 shrink-0">
            <CheckSquare className="h-3 w-3" />
            {checklist.filter(i => i.done).length}/{checklist.length}
          </span>
        )}

        {subtaskCount > 0 && (
          <span className="flex items-center gap-1 shrink-0">
            <div className="w-8 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-green-500 transition-all"
                style={{ width: `${subtaskCount > 0 ? (completedSubtasks / subtaskCount) * 100 : 0}%` }}
              />
            </div>
            {completedSubtasks}/{subtaskCount}
          </span>
        )}

        {commentCount > 0 && (
          <span className="flex items-center gap-0.5 shrink-0">
            <MessageSquare className="h-3 w-3" />
            {commentCount}
          </span>
        )}

        {attachmentCount > 0 && (
          <span className="flex items-center gap-0.5 shrink-0">
            <Paperclip className="h-3 w-3" />
            {attachmentCount}
          </span>
        )}

        {task.branch && (
          <span className="flex items-center gap-0.5 min-w-0" title={task.branch}>
            <GitBranch className="h-3 w-3 shrink-0" />
            <span className="truncate max-w-[70px]">{task.branch}</span>
          </span>
        )}

        {task.githubIssueUrl && (
          <span className="flex items-center gap-0.5 shrink-0">
            <Link2 className="h-3 w-3" />
            #{task.githubIssueNumber}
          </span>
        )}

        <span className="ml-auto flex items-center gap-1 shrink-0">
          <Clock className="h-3 w-3" />
          {new Date(task.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </span>
      </div>
    </div>
  );
}
