import { useState } from 'react';
import { X, ChevronDown, ChevronRight, RotateCcw, Clock } from 'lucide-react';
import type { ReviewBatch, ReviewComment } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface ReviewBatchPanelProps {
  batches: ReviewBatch[];
  comments: ReviewComment[];
  onRerun: (batchId: string) => void;
  onClose: () => void;
}

export function ReviewBatchPanel({
  batches,
  comments,
  onRerun,
  onClose,
}: ReviewBatchPanelProps) {
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);

  const getCommentsForBatch = (batchId: string) =>
    comments.filter(c => c.batchId === batchId);

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-card border-l shadow-xl z-50 flex flex-col">
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="font-semibold">Review History</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {batches.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No batches yet
          </p>
        ) : (
          batches.map(batch => (
            <div key={batch.batchId} className="border rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedBatch(
                  expandedBatch === batch.batchId ? null : batch.batchId
                )}
                className="w-full flex items-center gap-2 p-3 hover:bg-muted/50 text-left"
              >
                {expandedBatch === batch.batchId ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-xs px-1.5 py-0.5 rounded',
                      batch.status === 'resolved'
                        ? 'bg-green-500/10 text-green-500'
                        : 'bg-yellow-500/10 text-yellow-500'
                    )}>
                      {batch.status}
                    </span>
                    <span className="text-sm">{batch.count} comments</span>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                    <Clock className="h-3 w-3" />
                    {formatDate(batch.createdAt)}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRerun(batch.batchId);
                  }}
                  title="Re-run this batch"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </button>

              {expandedBatch === batch.batchId && (
                <div className="border-t bg-muted/30 p-3 space-y-2">
                  {getCommentsForBatch(batch.batchId).map(comment => (
                    <div key={comment.id} className="text-xs">
                      <div className="font-mono text-muted-foreground">
                        {comment.filePath}:{comment.lineNumber}
                      </div>
                      <div className="mt-0.5">{comment.comment}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
