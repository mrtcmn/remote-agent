import { useState, useRef } from 'react';
import {
  Send, Check, X, RotateCcw, Reply, Paperclip,
  Trash2, MessageSquare, CheckCircle2, XCircle
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { api, type TaskComment, type TaskAttachment } from '@/lib/api';

const statusStyles: Record<string, string> = {
  open: 'border-l-blue-400',
  resolved: 'border-l-green-400 bg-green-50/30 dark:bg-green-900/10',
  rejected: 'border-l-red-400 bg-red-50/30 dark:bg-red-900/10',
};

const statusIcons: Record<string, React.ReactNode> = {
  open: <MessageSquare className="h-3.5 w-3.5 text-blue-500" />,
  resolved: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
  rejected: <XCircle className="h-3.5 w-3.5 text-red-500" />,
};

interface TaskCommentsProps {
  taskId: string;
  comments: TaskComment[];
  onAddComment: (content: string, parentCommentId?: string) => void;
  onResolveComment: (commentId: string) => void;
  onRejectComment: (commentId: string) => void;
  onReopenComment: (commentId: string) => void;
  onDeleteComment: (commentId: string) => void;
  onUploadAttachment: (file: File, commentId?: string) => void;
}

export function TaskComments({
  taskId: _taskId,
  comments,
  onAddComment,
  onResolveComment,
  onRejectComment,
  onReopenComment,
  onDeleteComment,
  onUploadAttachment,
}: TaskCommentsProps) {
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    if (newComment.trim()) {
      onAddComment(newComment.trim());
      setNewComment('');
    }
  };

  const handleReply = (parentId: string) => {
    if (replyContent.trim()) {
      onAddComment(replyContent.trim(), parentId);
      setReplyContent('');
      setReplyingTo(null);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, commentId?: string) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadAttachment(file, commentId);
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-sm flex items-center gap-2">
        <MessageSquare className="h-4 w-4" />
        Comments ({comments.length})
      </h3>

      {/* Comment List */}
      <div className="space-y-3">
        {comments.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            onResolve={onResolveComment}
            onReject={onRejectComment}
            onReopen={onReopenComment}
            onDelete={onDeleteComment}
            onReply={(id) => { setReplyingTo(id); setReplyContent(''); }}
            replyingTo={replyingTo}
            replyContent={replyContent}
            onReplyContentChange={setReplyContent}
            onSubmitReply={handleReply}
            onCancelReply={() => setReplyingTo(null)}
            onUploadAttachment={onUploadAttachment}
          />
        ))}
      </div>

      {/* New Comment Input */}
      <div className="flex gap-2 pt-2 border-t">
        <div className="flex-1 flex gap-1">
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
            }}
            placeholder="Add a comment... (Ctrl+Enter to send)"
            className="flex-1 min-h-[60px] max-h-[120px] px-3 py-2 text-sm rounded-md border bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring"
            rows={2}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Button size="icon" className="h-8 w-8" onClick={handleSubmit} disabled={!newComment.trim()}>
            <Send className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-3.5 w-3.5" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,.pdf,.doc,.docx,.txt,.md"
            onChange={(e) => handleFileSelect(e)}
          />
        </div>
      </div>
    </div>
  );
}

function CommentItem({
  comment,
  onResolve,
  onReject,
  onReopen,
  onDelete,
  onReply,
  replyingTo,
  replyContent,
  onReplyContentChange,
  onSubmitReply,
  onCancelReply,
  onUploadAttachment: _onUploadAttachment,
}: {
  comment: TaskComment;
  onResolve: (id: string) => void;
  onReject: (id: string) => void;
  onReopen: (id: string) => void;
  onDelete: (id: string) => void;
  onReply: (id: string) => void;
  replyingTo: string | null;
  replyContent: string;
  onReplyContentChange: (v: string) => void;
  onSubmitReply: (parentId: string) => void;
  onCancelReply: () => void;
  onUploadAttachment: (file: File, commentId?: string) => void;
}) {
  return (
    <div className={cn('border-l-2 pl-3 py-2 rounded-r-md', statusStyles[comment.status])}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        {statusIcons[comment.status]}
        <span className="text-xs font-medium">
          {comment.user?.name || 'Unknown'}
        </span>
        <span className="text-xs text-muted-foreground">
          {new Date(comment.createdAt).toLocaleDateString(undefined, {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          })}
        </span>
        <span className={cn(
          'ml-auto text-[10px] px-1.5 py-0.5 rounded font-medium',
          comment.status === 'open' && 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
          comment.status === 'resolved' && 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
          comment.status === 'rejected' && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
        )}>
          {comment.status}
        </span>
      </div>

      {/* Content */}
      <p className="text-sm whitespace-pre-wrap mb-2">{comment.content}</p>

      {/* Attachments */}
      {comment.attachments && comment.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {comment.attachments.map((att) => (
            <AttachmentPreview key={att.id} attachment={att} />
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1">
        {comment.status === 'open' && (
          <>
            <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1 text-green-600" onClick={() => onResolve(comment.id)}>
              <Check className="h-3 w-3" /> Resolve
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1 text-red-600" onClick={() => onReject(comment.id)}>
              <X className="h-3 w-3" /> Reject
            </Button>
          </>
        )}
        {(comment.status === 'resolved' || comment.status === 'rejected') && (
          <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1" onClick={() => onReopen(comment.id)}>
            <RotateCcw className="h-3 w-3" /> Reopen
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1" onClick={() => onReply(comment.id)}>
          <Reply className="h-3 w-3" /> Reply
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1 text-destructive" onClick={() => onDelete(comment.id)}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-2 ml-4 space-y-2">
          {comment.replies.map((reply) => (
            <div key={reply.id} className="border-l-2 border-muted pl-3 py-1">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium">{reply.user?.name || 'Unknown'}</span>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(reply.createdAt).toLocaleDateString(undefined, {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{reply.content}</p>
            </div>
          ))}
        </div>
      )}

      {/* Reply Input */}
      {replyingTo === comment.id && (
        <div className="mt-2 ml-4 flex gap-1">
          <input
            autoFocus
            value={replyContent}
            onChange={(e) => onReplyContentChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmitReply(comment.id);
              if (e.key === 'Escape') onCancelReply();
            }}
            placeholder="Write a reply..."
            className="flex-1 h-8 px-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button size="sm" className="h-8" onClick={() => onSubmitReply(comment.id)}>
            <Send className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={onCancelReply}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

function AttachmentPreview({ attachment }: { attachment: TaskAttachment }) {
  const isImage = attachment.mimetype.startsWith('image/');
  const url = api.getAttachmentUrl(attachment.id);

  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={url}
          alt={attachment.filename}
          className="max-w-[200px] max-h-[150px] rounded-md border object-cover hover:opacity-90 transition-opacity"
        />
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-md border bg-muted/50 hover:bg-muted transition-colors"
    >
      <Paperclip className="h-3.5 w-3.5" />
      <span className="truncate max-w-[120px]">{attachment.filename}</span>
      <span className="text-muted-foreground">({(attachment.size / 1024).toFixed(0)}KB)</span>
    </a>
  );
}
