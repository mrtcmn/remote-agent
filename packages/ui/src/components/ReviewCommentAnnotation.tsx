import { MessageSquare, Loader2, Check, AlertCircle } from 'lucide-react';
import type { ReviewComment, ReviewCommentStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

interface ReviewCommentAnnotationProps {
  comment: ReviewComment;
  currentFileSha?: string | null;
  onDelete?: (id: string) => void;
}

const statusConfig: Record<ReviewCommentStatus, { color: string; icon: typeof MessageSquare; label: string }> = {
  pending: { color: 'text-blue-500 bg-blue-500/10 border-blue-500/30', icon: MessageSquare, label: 'Pending' },
  running: { color: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30', icon: Loader2, label: 'Running' },
  resolved: { color: 'text-green-500 bg-green-500/10 border-green-500/30', icon: Check, label: 'Resolved' },
};

export function ReviewCommentAnnotation({
  comment,
  currentFileSha,
  onDelete,
}: ReviewCommentAnnotationProps) {
  const config = statusConfig[comment.status];
  const Icon = config.icon;
  const fileChanged = comment.fileSha && currentFileSha && comment.fileSha !== currentFileSha;

  return (
    <div className={cn(
      'flex items-start gap-2 p-2 rounded border text-sm',
      config.color
    )}>
      <Icon className={cn(
        'h-4 w-4 mt-0.5 shrink-0',
        comment.status === 'running' && 'animate-spin'
      )} />
      <div className="flex-1 min-w-0">
        <p className="text-foreground">{comment.comment}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs opacity-70">{config.label}</span>
          {fileChanged && (
            <span className="text-xs text-yellow-500 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              File changed
            </span>
          )}
        </div>
      </div>
      {comment.status === 'pending' && onDelete && (
        <button
          onClick={() => onDelete(comment.id)}
          className="text-xs text-muted-foreground hover:text-destructive"
        >
          Delete
        </button>
      )}
    </div>
  );
}
