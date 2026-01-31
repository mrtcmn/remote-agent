import { useState } from 'react';
import { MessageSquarePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface ReviewCommentInputProps {
  onSubmit: (comment: string) => void;
  onCancel: () => void;
  existingComments?: { id: string; comment: string }[];
  isLoading?: boolean;
}

export function ReviewCommentInput({
  onSubmit,
  onCancel,
  existingComments = [],
  isLoading,
}: ReviewCommentInputProps) {
  const [comment, setComment] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (comment.trim()) {
      onSubmit(comment.trim());
      setComment('');
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg shadow-lg p-3 min-w-[300px]">
      {existingComments.length > 0 && (
        <div className="mb-3 space-y-2">
          {existingComments.map(c => (
            <div key={c.id} className="text-xs bg-muted/50 p-2 rounded">
              {c.comment}
            </div>
          ))}
          <div className="h-px bg-border" />
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add review comment..."
          className={cn(
            'w-full bg-background border border-input rounded-md p-2 text-sm',
            'resize-none min-h-[80px] focus:outline-none focus:ring-2 focus:ring-primary'
          )}
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
          >
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={!comment.trim() || isLoading}
          >
            <MessageSquarePlus className="h-4 w-4 mr-1" />
            Add Comment
          </Button>
        </div>
      </form>
    </div>
  );
}
