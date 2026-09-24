import { useEffect, useState } from 'react';
import { Gavel, Undo2, Target, Sparkles, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { MAX_VERIFY_ATTEMPTS } from '@/lib/task-live';
import type { KanbanTask, VerifyStatus } from '@/lib/api';

const statusText: Record<VerifyStatus, { label: string; className: string }> = {
  none: { label: 'Not judged yet', className: 'text-muted-foreground' },
  drafting: { label: 'Writing the goal…', className: 'text-blue-500' },
  running: { label: 'The referee is judging…', className: 'text-blue-500' },
  passed: { label: 'Goal met', className: 'text-green-500' },
  failed: { label: 'Goal not met', className: 'text-red-500' },
  stuck: { label: 'Stuck — the loop stopped', className: 'text-red-500' },
};

const PLACEHOLDER = `What must be true for this task to be done?

Write it as conditions a referee can check by running something, for example:
- bun test passes, and the new bench test covers the hot path
- the bench is at least 30% faster than main on the same input
- no public API changes`;

/** Human review comments still open — what "send back" hands the agent. */
export function openReviewCount(task: KanbanTask): number {
  let n = 0;
  for (const c of task.comments ?? []) {
    if (c.kind !== 'user') continue;
    if (c.status === 'open') n++;
    n += (c.replies ?? []).filter(r => r.kind === 'user' && r.status === 'open').length;
  }
  return n;
}

/**
 * The task loop: the goal a referee agent judges before the task leaves In
 * Progress, and a way to hand open review comments back to the worker.
 */
export function TaskLoop({
  task,
  onUpdate,
  onVerify,
  onDraftGoal,
  onSendBack,
}: {
  task: KanbanTask;
  onUpdate: (data: Record<string, any>) => void;
  onVerify: (goal: string) => void;
  onDraftGoal: () => void;
  onSendBack: (note?: string) => void;
}) {
  const [goal, setGoal] = useState(task.goal ?? '');
  const [note, setNote] = useState('');
  const [showVerdict, setShowVerdict] = useState(true);
  useEffect(() => setGoal(task.goal ?? ''), [task.goal]);

  const status = statusText[task.verifyStatus] ?? statusText.none;
  const openCount = openReviewCount(task);
  const judging = task.verifyStatus === 'running';
  const drafting = task.verifyStatus === 'drafting';

  const saveGoal = () => {
    if (goal.trim() !== (task.goal ?? '')) onUpdate({ goal: goal.trim() || null });
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1">
            <Target className="h-3 w-3" /> Goal
          </label>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px] gap-1 ml-auto"
            onClick={onDraftGoal}
            disabled={drafting}
            title="Let an agent read the repository and write the goal"
          >
            {drafting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Draft
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px] gap-1"
            onClick={() => { saveGoal(); onVerify(goal.trim()); }}
            disabled={!goal.trim() || judging || drafting}
            title="Send the referee in now"
          >
            {judging ? <Loader2 className="h-3 w-3 animate-spin" /> : <Gavel className="h-3 w-3" />}
            Judge now
          </Button>
        </div>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onBlur={saveGoal}
          placeholder={PLACEHOLDER}
          rows={goal ? Math.min(10, goal.split('\n').length + 1) : 4}
          className="w-full px-3 py-2 text-sm rounded-md border bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {(task.goal || drafting) && (
          <div className="flex items-center gap-2 mt-1 text-xs">
            <span className={status.className}>{status.label}</span>
            {task.verifyAttempts > 0 && (
              <span className="text-muted-foreground">
                attempt {task.verifyAttempts}/{MAX_VERIFY_ATTEMPTS}
              </span>
            )}
            {task.verifyOutput && (
              <button
                onClick={() => setShowVerdict(!showVerdict)}
                className="ml-auto flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
              >
                {showVerdict ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                Verdict
              </button>
            )}
          </div>
        )}
        {showVerdict && task.verifyOutput && (
          <pre className="mt-1 max-h-48 overflow-auto rounded-md border bg-muted/50 p-2 text-[11px] leading-snug whitespace-pre-wrap">
            {task.verifyOutput}
          </pre>
        )}
        {!task.goal && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Optional. When the agent stops, a referee agent runs its own commands and decides whether the goal is met.
            A verdict of "not met" goes back to the agent, up to {MAX_VERIFY_ATTEMPTS} times. The planner writes this
            section too.
          </p>
        )}
      </div>

      <div className="flex gap-1">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={openCount ? `Send ${openCount} open comment${openCount > 1 ? 's' : ''} — add a note (optional)` : 'Note for the agent…'}
          className="h-8 text-xs flex-1"
        />
        <Button
          size="sm"
          className="h-8 text-xs gap-1"
          disabled={!openCount && !note.trim()}
          onClick={() => { onSendBack(note.trim() || undefined); setNote(''); }}
          title="Type the open review comments into the agent's session, or start a background run"
        >
          <Undo2 className="h-3 w-3" /> Send back to agent
        </Button>
      </div>
    </div>
  );
}
