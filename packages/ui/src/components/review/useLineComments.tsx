import { useCallback, useState } from 'react';
import { Plus } from 'lucide-react';
import { useReviewComments } from '@/hooks/useReviewComments';
import { toast } from '@/components/ui/Toaster';
import { ReviewCommentInput } from '../ReviewCommentInput';
import { ReviewThread } from './ReviewThread';
import { ReviewComposer, type ReviewTarget } from './ReviewComposer';

type Side = 'additions' | 'deletions';

/** One annotation per commented line; `metadata` keys the thread. */
export interface LineCommentAnnotation {
  lineNumber: number;
  side: Side;
  metadata: string;
}

/** Key that groups every comment on one line into a single thread. */
const threadKey = (filePath: string, side: string, lineNumber: number) =>
  `${filePath}\0${side}\0${lineNumber}`;

interface Options {
  /** Name of the live agent terminal, used to label the "open session" target. */
  currentTargetLabel?: string;
  onProceed?: (message: string, target: ReviewTarget) => void;
}

/**
 * Line comments shared by the file viewer and the diff viewer: the inline
 * threads, the "+" gutter button, the input popover, and the send bar. A file
 * line is the diff's additions side, so a comment shows in both views.
 */
export function useLineComments(sessionId: string, { currentTargetLabel, onProceed }: Options) {
  const review = useReviewComments(sessionId);
  const { comments, pendingComments, createComment, deleteComment, resolveBatch, proceed } = review;

  const [popover, setPopover] = useState<{
    filePath: string;
    lineNumber: number;
    side: Side;
    lineContent: string;
    x: number;
    y: number;
  } | null>(null);

  const annotationsFor = useCallback(
    (filePath: string): LineCommentAnnotation[] => {
      const seen = new Set<string>();
      const annotations: LineCommentAnnotation[] = [];
      for (const c of comments) {
        if (c.filePath !== filePath) continue;
        const key = threadKey(c.filePath, c.lineSide, c.lineNumber);
        if (seen.has(key)) continue;
        seen.add(key);
        annotations.push({ lineNumber: c.lineNumber, side: c.lineSide, metadata: key });
      }
      return annotations;
    },
    [comments]
  );

  const renderAnnotation = useCallback(
    (annotation: { metadata: string }) => {
      const thread = comments.filter(
        (c) => threadKey(c.filePath, c.lineSide, c.lineNumber) === annotation.metadata
      );
      if (thread.length === 0) return null;
      const head = thread[0];
      return (
        <ReviewThread
          comments={thread}
          onReply={(text) =>
            createComment({
              filePath: head.filePath,
              lineNumber: head.lineNumber,
              lineSide: head.lineSide,
              lineContent: head.lineContent,
              comment: text,
            })
          }
          onDelete={deleteComment}
          onResolve={resolveBatch}
        />
      );
    },
    [comments, createComment, deleteComment, resolveBatch]
  );

  /** The "+" shown in the gutter of the hovered line. `lineText` fills the quoted code. */
  const gutterFor = useCallback(
    (filePath: string, lineText?: (lineNumber: number) => string) =>
      (getHoveredLine: () => { lineNumber: number; side?: Side } | undefined) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            const hovered = getHoveredLine();
            if (!hovered) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const side = hovered.side ?? 'additions';
            setPopover({
              filePath,
              lineNumber: hovered.lineNumber,
              side,
              lineContent: side === 'additions' ? lineText?.(hovered.lineNumber) ?? '' : '',
              x: Math.min(rect.right + 8, window.innerWidth - 340),
              y: Math.min(rect.top, window.innerHeight - 220),
            });
          }}
          className="flex items-center justify-center w-5 h-5 rounded bg-primary text-primary-foreground shadow hover:brightness-110 transition"
          title="Comment on this line"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      ),
    []
  );

  const send = useCallback(
    async (target: ReviewTarget, note: string) => {
      try {
        const result = await proceed();
        const message = note
          ? `${result.message}\n\n## Additional instructions\n\n${note}`
          : result.message;
        onProceed?.(message, target);
      } catch (e) {
        toast({ title: 'Could not send the review', description: (e as Error).message, variant: 'destructive' });
      }
    },
    [proceed, onProceed]
  );

  const popoverElement = popover && (
    <div className="fixed z-50" style={{ left: popover.x, top: popover.y }}>
      <ReviewCommentInput
        onSubmit={(comment) => {
          createComment({
            filePath: popover.filePath,
            lineNumber: popover.lineNumber,
            lineSide: popover.side,
            lineContent: popover.lineContent,
            comment,
          });
          setPopover(null);
        }}
        onCancel={() => setPopover(null)}
        existingComments={comments
          .filter(
            (c) =>
              c.filePath === popover.filePath &&
              c.lineNumber === popover.lineNumber &&
              c.lineSide === popover.side &&
              c.status === 'pending'
          )
          .map((c) => ({ id: c.id, comment: c.comment }))}
      />
    </div>
  );

  const composer = (
    <ReviewComposer
      sessionId={sessionId}
      pendingCount={pendingComments.length}
      currentTargetLabel={currentTargetLabel}
      isPending={review.isProceedPending}
      onSend={send}
    />
  );

  return { ...review, annotationsFor, renderAnnotation, gutterFor, popoverElement, composer };
}
