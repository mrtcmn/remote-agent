import * as ContextMenu from '@radix-ui/react-context-menu';
import {
  ChevronRight, Copy, Gavel, GitPullRequest, Maximize2, Flag,
  TerminalSquare, Trash2, Undo2, ArrowRightLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KanbanStatus, KanbanPriority, KanbanTask } from '@/lib/api';

const STATUSES: { value: KanbanStatus; label: string; dot: string }[] = [
  { value: 'backlog', label: 'Backlog', dot: 'bg-zinc-500' },
  { value: 'todo', label: 'To Do', dot: 'bg-blue-400' },
  { value: 'in_progress', label: 'In Progress', dot: 'bg-yellow-400' },
  { value: 'manual_testing', label: 'Manual Testing', dot: 'bg-orange-400' },
  { value: 'review_needed', label: 'Review Needed', dot: 'bg-purple-400' },
  { value: 'completed', label: 'Completed', dot: 'bg-green-400' },
];

const PRIORITIES: { value: KanbanPriority; label: string; className: string }[] = [
  { value: 'critical', label: 'Critical', className: 'text-red-500' },
  { value: 'high', label: 'High', className: 'text-orange-500' },
  { value: 'medium', label: 'Medium', className: 'text-blue-500' },
  { value: 'low', label: 'Low', className: 'text-muted-foreground' },
];

const item = 'flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm cursor-pointer outline-none hover:bg-accent data-[disabled]:opacity-40 data-[disabled]:pointer-events-none';
const content = 'min-w-[180px] rounded-md border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95 z-50';

export interface TaskMenuHandlers {
  onOpen: (task: KanbanTask) => void;
  onMove: (task: KanbanTask, status: KanbanStatus) => void;
  onPriority: (task: KanbanTask, priority: KanbanPriority) => void;
  onOpenSession: (task: KanbanTask) => void;
  onJudge: (task: KanbanTask) => void;
  onSendBack: (task: KanbanTask) => void;
  onDelete: (task: KanbanTask) => void;
}

/** Right-click on a card: the moves you would otherwise open the panel to make. */
export function TaskContextMenu({
  task,
  children,
  handlers,
}: {
  task: KanbanTask;
  children: React.ReactNode;
  handlers: TaskMenuHandlers;
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={content}>
          <ContextMenu.Item className={item} onSelect={() => handlers.onOpen(task)}>
            <Maximize2 className="h-3.5 w-3.5" />
            Open
          </ContextMenu.Item>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={item}>
              <ArrowRightLeft className="h-3.5 w-3.5" />
              Move to
              <ChevronRight className="h-3.5 w-3.5 ml-auto" />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={content}>
                {STATUSES.map(s => (
                  <ContextMenu.Item
                    key={s.value}
                    className={item}
                    disabled={s.value === task.status}
                    onSelect={() => handlers.onMove(task, s.value)}
                  >
                    <span className={cn('h-2 w-2 rounded-full', s.dot)} />
                    {s.label}
                  </ContextMenu.Item>
                ))}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={item}>
              <Flag className="h-3.5 w-3.5" />
              Priority
              <ChevronRight className="h-3.5 w-3.5 ml-auto" />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={content}>
                {PRIORITIES.map(p => (
                  <ContextMenu.Item
                    key={p.value}
                    className={cn(item, p.className)}
                    disabled={p.value === task.priority}
                    onSelect={() => handlers.onPriority(task, p.value)}
                  >
                    <Flag className="h-3.5 w-3.5" />
                    {p.label}
                  </ContextMenu.Item>
                ))}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Separator className="h-px bg-border my-1" />

          {task.sessionId && (
            <ContextMenu.Item className={item} onSelect={() => handlers.onOpenSession(task)}>
              <TerminalSquare className="h-3.5 w-3.5" />
              Open session
            </ContextMenu.Item>
          )}

          <ContextMenu.Item className={item} disabled={!task.goal} onSelect={() => handlers.onJudge(task)}>
            <Gavel className="h-3.5 w-3.5" />
            Judge now
          </ContextMenu.Item>

          <ContextMenu.Item className={item} onSelect={() => handlers.onSendBack(task)}>
            <Undo2 className="h-3.5 w-3.5" />
            Send back to agent
          </ContextMenu.Item>

          {task.prUrl && (
            <ContextMenu.Item className={item} onSelect={() => window.open(task.prUrl!, '_blank', 'noopener,noreferrer')}>
              <GitPullRequest className="h-3.5 w-3.5" />
              Open pull request
            </ContextMenu.Item>
          )}

          <ContextMenu.Separator className="h-px bg-border my-1" />

          <ContextMenu.Item className={item} onSelect={() => { void navigator.clipboard?.writeText(task.id).catch(() => {}); }}>
            <Copy className="h-3.5 w-3.5" />
            Copy task id
          </ContextMenu.Item>

          <ContextMenu.Item
            className={cn(item, 'text-destructive')}
            onSelect={() => handlers.onDelete(task)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete…
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
