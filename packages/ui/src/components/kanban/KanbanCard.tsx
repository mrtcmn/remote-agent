import {
  MessageSquare, Paperclip, GitBranch, AlertTriangle,
  Bot, User as UserIcon, Clock, ChevronRight, Link2, FileText, CheckSquare,
  FolderGit2, GitPullRequest
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseChecklist } from '@/lib/task-prompt';
import { cardState, MAX_VERIFY_ATTEMPTS, type CardTone, type SessionLive } from '@/lib/task-live';
import { TaskContextMenu, type TaskMenuHandlers } from './TaskContextMenu';
import type { KanbanTask } from '@/lib/api';

// Blue pulses while an agent works; amber holds still because it waits on you.
const toneStyles: Record<CardTone, { ring: string; pill: string; dot: string }> = {
  working: { ring: 'ring-1 ring-blue-500/40', pill: 'text-blue-500', dot: 'bg-blue-500 animate-pulse' },
  needs: { ring: 'ring-1 ring-amber-500/60', pill: 'text-amber-500', dot: 'bg-amber-500' },
  failed: { ring: 'ring-1 ring-red-500/50', pill: 'text-red-500', dot: 'bg-red-500' },
  passed: { ring: '', pill: 'text-green-500', dot: 'bg-green-500' },
};

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

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
  /** Set when the board spans every project, so the card must name its own. */
  showProject?: boolean;
  /** The linked session's live state, when the task has one. */
  live?: SessionLive;
  menu: TaskMenuHandlers;
}

export function KanbanCard({ task, onClick, showProject, live, menu }: KanbanCardProps) {
  const state = cardState(task, live);
  const tone = state ? toneStyles[state.tone] : null;
  const labels = task.labels ? JSON.parse(task.labels) as string[] : [];
  const checklist = parseChecklist(task.checklist);
  const checklistDone = checklist.filter(i => i.done).length;
  const prNumber = task.prUrl?.match(/\/pull\/(\d+)/)?.[1];
  const commentCount = task.comments?.length || 0;
  const attachmentCount = task.attachments?.length || 0;
  const subtaskCount = task.subtasks?.length || 0;
  const completedSubtasks = task.subtasks?.filter(s => s.status === 'completed').length || 0;
  const isBlocked = task.dependencies?.some(d => d.dependsOn && d.dependsOn.status !== 'completed');

  return (
    <TaskContextMenu task={task} handlers={menu}>
    <div
      onClick={() => onClick(task)}
      className={cn(
        // The whole card is the drag handle, so it carries the grab cursor. A
        // separate grip icon sat on top of the priority border and overflowed it.
        // `touch-none` keeps a drag on a touch screen from scrolling the column.
        'group relative px-2.5 py-2 rounded-lg border border-l-[3px] bg-card cursor-grab active:cursor-grabbing touch-none select-none',
        'hover:shadow-md hover:border-primary/30 transition-all duration-150',
        'active:shadow-sm active:scale-[0.98]',
        priorityColors[task.priority],
        tone?.ring,
        isBlocked && 'opacity-70',
      )}
      title={`${task.priority} priority`}
    >
      {/* Project and blocked share the top line — both are card-level context */}
      {(state || isBlocked || (showProject && task.project)) && (
        <div className="flex items-center gap-1.5 mb-0.5 text-[10px] font-medium text-muted-foreground">
          {state && tone && (
            <span className={cn('flex items-center gap-1 shrink-0', tone.pill)}>
              <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />
              {state.label}
              {task.verifyAttempts > 0 && task.verifyStatus !== 'passed' && (
                <span className="opacity-70">{task.verifyAttempts}/{MAX_VERIFY_ATTEMPTS}</span>
              )}
            </span>
          )}
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

      {/* The agent's question, so you can tell from the board what it waits on */}
      {live?.question && state?.tone === 'needs' && (
        <p className="mt-0.5 text-[11px] leading-snug text-amber-600 dark:text-amber-400 line-clamp-2">
          {live.question}
        </p>
      )}

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

        {/* A written plan. A run in flight or failed shows in the state pill instead. */}
        {(task.planStatus === 'ready' || task.planStatus === 'done') && (
          <span className="flex items-center gap-1 text-primary shrink-0">
            <FileText className="h-3 w-3" />
            Plan
          </span>
        )}

        {task.autoFlow && (
          <span className="flex items-center text-violet-400 shrink-0" title="Auto-flow">
            <ChevronRight className="h-3 w-3" />
          </span>
        )}

        {checklist.length > 0 && (
          <span className="flex items-center gap-1 shrink-0" title="Checklist">
            <CheckSquare className={cn('h-3 w-3', checklistDone === checklist.length && 'text-green-500')} />
            <div className="w-8 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-green-500 transition-all"
                style={{ width: `${(checklistDone / checklist.length) * 100}%` }}
              />
            </div>
            {checklistDone}/{checklist.length}
          </span>
        )}

        {live?.diffStats && (
          <span className="flex items-center gap-1 shrink-0 font-mono" title="Uncommitted changes in the session">
            <span className="text-green-500">+{live.diffStats.additions}</span>
            <span className="text-red-500">−{live.diffStats.deletions}</span>
          </span>
        )}

        {task.prUrl && (
          <a
            href={task.prUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-0.5 shrink-0 text-violet-500 hover:underline"
            title={task.prUrl}
          >
            <GitPullRequest className="h-3 w-3" />
            {prNumber ? `#${prNumber}` : 'PR'}
          </a>
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

        <span className="ml-auto flex items-center gap-1 shrink-0" title={`Updated ${new Date(task.updatedAt).toLocaleString()}`}>
          <Clock className="h-3 w-3" />
          {timeAgo(task.updatedAt)}
        </span>
      </div>
    </div>
    </TaskContextMenu>
  );
}
