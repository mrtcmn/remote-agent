import { useState } from 'react';
import { Check, Loader2, Trash2, CornerDownLeft, AlertCircle } from 'lucide-react';
import type { ReviewComment } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Short relative time, e.g. "now", "3m", "2h", "4d". */
export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'now';
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

const statusChip: Record<ReviewComment['status'], { label: string; className: string }> = {
  pending: { label: 'Draft', className: 'text-sky-400 bg-sky-500/10 ring-sky-500/25' },
  running: { label: 'Sent', className: 'text-amber-400 bg-amber-500/10 ring-amber-500/25' },
  resolved: { label: 'Resolved', className: 'text-emerald-400 bg-emerald-500/10 ring-emerald-500/25' },
};

interface ReviewThreadProps {
  /** Every comment on one line, oldest first. */
  comments: ReviewComment[];
  currentFileSha?: string | null;
  onReply: (text: string) => void;
  onDelete: (id: string) => void;
  onResolve?: (batchId: string) => void;
}

/**
 * An inline comment thread rendered inside the diff, in the style of diffs.com:
 * stacked messages with an author, a relative time, and a reply composer.
 */
export function ReviewThread({
  comments,
  currentFileSha,
  onReply,
  onDelete,
  onResolve,
}: ReviewThreadProps) {
  const [reply, setReply] = useState('');
  const [composing, setComposing] = useState(false);

  if (comments.length === 0) return null;

  const head = comments[0];
  const chip = statusChip[head.status];
  const batchId = comments.find((c) => c.batchId)?.batchId;
  const staleFile = head.fileSha && currentFileSha && head.fileSha !== currentFileSha;

  const submitReply = () => {
    const text = reply.trim();
    if (!text) return;
    onReply(text);
    setReply('');
    setComposing(false);
  };

  return (
    <div className="my-1.5 mx-2 rounded-lg border border-border/70 bg-card shadow-lg shadow-black/20 overflow-hidden text-sm">
      {/* Thread header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-card/60">
        <span
          className={cn(
            'text-[10px] font-medium px-1.5 py-0.5 rounded-full ring-1 ring-inset',
            chip.className
          )}
        >
          {head.status === 'running' && <Loader2 className="inline h-2.5 w-2.5 mr-1 animate-spin" />}
          {chip.label}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
        </span>
        {staleFile && (
          <span className="text-[11px] text-amber-500 flex items-center gap-1" title="The file changed after this comment">
            <AlertCircle className="h-3 w-3" />
            stale
          </span>
        )}
        <div className="flex-1" />
        {batchId && head.status !== 'resolved' && onResolve && (
          <button
            onClick={() => onResolve(batchId)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-emerald-400 transition-colors"
          >
            <Check className="h-3 w-3" />
            Resolve
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="divide-y divide-border/40">
        {comments.map((comment) => (
          <div key={comment.id} className="group px-3 py-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="h-4 w-4 rounded-full bg-primary/20 text-primary text-[9px] font-bold flex items-center justify-center shrink-0">
                Y
              </span>
              <span className="text-[11px] font-semibold text-primary">You</span>
              <span className="text-[11px] text-muted-foreground">{timeAgo(comment.createdAt)}</span>
              <div className="flex-1" />
              {comment.status === 'pending' && (
                <button
                  onClick={() => onDelete(comment.id)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                  title="Delete comment"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
            <p className="text-[13px] leading-relaxed text-foreground whitespace-pre-wrap pl-6">
              {comment.comment}
            </p>
          </div>
        ))}
      </div>

      {/* Reply composer */}
      <div className="px-3 py-2 border-t border-border/50 bg-card/40">
        {composing ? (
          <div className="space-y-1.5">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitReply();
                if (e.key === 'Escape') {
                  setComposing(false);
                  setReply('');
                }
              }}
              placeholder="Add a reply…"
              autoFocus
              className="w-full min-h-[56px] rounded-md border border-input bg-background px-2 py-1.5 text-[13px] resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={submitReply}
                disabled={!reply.trim()}
                className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-40"
              >
                <CornerDownLeft className="h-3 w-3" />
                Reply
              </button>
              <button
                onClick={() => {
                  setComposing(false);
                  setReply('');
                }}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <span className="ml-auto text-[10px] text-muted-foreground/70">⌘↵ to send</span>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setComposing(true)}
            className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Add reply…
          </button>
        )}
      </div>
    </div>
  );
}
