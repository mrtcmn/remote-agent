# Review Comments Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add inline code review annotations to GitDiffView that persist to database, batch together, and send to Claude Code for automated fixes.

**Architecture:** New `review_comments` table with Drizzle ORM, REST endpoints under `/sessions/:id/review-comments`, React components using `@pierre/diffs` annotation API, React Query for state management.

**Tech Stack:** Drizzle ORM, Elysia routes, React + TanStack Query, @pierre/diffs annotations

---

## Task 1: Database Schema

**Files:**
- Modify: `packages/api/src/db/schema.ts`

**Step 1: Add the review comment status enum and table**

Add after existing enums (around line 15):

```typescript
export const reviewCommentStatusEnum = pgEnum('review_comment_status', ['pending', 'running', 'resolved']);
export const lineSideEnum = pgEnum('line_side', ['additions', 'deletions']);
```

Add the table after `terminals` table:

```typescript
export const reviewComments = pgTable('review_comments', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => claudeSessions.id, { onDelete: 'cascade' }).notNull(),
  batchId: text('batch_id'),
  filePath: text('file_path').notNull(),
  lineNumber: integer('line_number').notNull(),
  lineSide: lineSideEnum('line_side').notNull(),
  lineContent: text('line_content').notNull(),
  fileSha: text('file_sha'),
  comment: text('comment').notNull(),
  status: reviewCommentStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at'),
});
```

**Step 2: Generate migration**

Run: `cd packages/api && bun run db:generate`

**Step 3: Apply migration**

Run: `cd packages/api && bun run db:migrate`

**Step 4: Commit**

```bash
git add packages/api/src/db/schema.ts packages/api/drizzle/
git commit -m "feat(db): add review_comments table for code review annotations"
```

---

## Task 2: Git Service - File SHA Method

**Files:**
- Modify: `packages/api/src/services/git/git.service.ts`

**Step 1: Add getFileSha method**

Add to GitService class (after the `diff` method):

```typescript
async getFileSha(projectPath: string, filePath: string): Promise<string | null> {
  try {
    const result = await $`git hash-object ${filePath}`.cwd(projectPath).quiet();
    if (result.exitCode !== 0) return null;
    return result.stdout.toString().trim();
  } catch {
    return null;
  }
}
```

**Step 2: Commit**

```bash
git add packages/api/src/services/git/git.service.ts
git commit -m "feat(git): add getFileSha method for tracking file changes"
```

---

## Task 3: API Routes - Review Comments

**Files:**
- Create: `packages/api/src/routes/review-comments.routes.ts`
- Modify: `packages/api/src/routes/index.ts`

**Step 1: Create the routes file**

```typescript
import { Elysia, t } from 'elysia';
import { nanoid } from 'nanoid';
import { eq, and, isNull } from 'drizzle-orm';
import { db, reviewComments, claudeSessions, projects } from '../db';
import { gitService } from '../services/git';
import { requireAuth } from '../auth/middleware';

export const reviewCommentsRoutes = new Elysia({ prefix: '/sessions/:sessionId/review-comments' })
  .use(requireAuth)

  // List comments for session
  .get('/', async ({ user, params, query }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.sessionId),
        eq(claudeSessions.userId, user!.id)
      ),
    });

    if (!session) return [];

    let conditions = [eq(reviewComments.sessionId, params.sessionId)];

    if (query.status) {
      conditions.push(eq(reviewComments.status, query.status as 'pending' | 'running' | 'resolved'));
    }
    if (query.batchId) {
      conditions.push(eq(reviewComments.batchId, query.batchId));
    }

    return db.query.reviewComments.findMany({
      where: and(...conditions),
      orderBy: (c, { asc }) => [asc(c.createdAt)],
    });
  }, {
    params: t.Object({ sessionId: t.String() }),
    query: t.Object({
      status: t.Optional(t.String()),
      batchId: t.Optional(t.String()),
    }),
  })

  // Create comment
  .post('/', async ({ user, params, body, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.sessionId),
        eq(claudeSessions.userId, user!.id)
      ),
      with: { project: true },
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    const commentId = nanoid();

    await db.insert(reviewComments).values({
      id: commentId,
      sessionId: params.sessionId,
      filePath: body.filePath,
      lineNumber: body.lineNumber,
      lineSide: body.lineSide,
      lineContent: body.lineContent,
      fileSha: body.fileSha,
      comment: body.comment,
      status: 'pending',
    });

    return db.query.reviewComments.findFirst({
      where: eq(reviewComments.id, commentId),
    });
  }, {
    params: t.Object({ sessionId: t.String() }),
    body: t.Object({
      filePath: t.String(),
      lineNumber: t.Number(),
      lineSide: t.Union([t.Literal('additions'), t.Literal('deletions')]),
      lineContent: t.String(),
      fileSha: t.Optional(t.String()),
      comment: t.String(),
    }),
  })

  // Update comment
  .patch('/:id', async ({ user, params, body, set }) => {
    const comment = await db.query.reviewComments.findFirst({
      where: eq(reviewComments.id, params.id),
      with: {
        session: true,
      },
    });

    if (!comment || comment.session.userId !== user!.id) {
      set.status = 404;
      return { error: 'Comment not found' };
    }

    if (comment.status !== 'pending') {
      set.status = 400;
      return { error: 'Can only edit pending comments' };
    }

    await db.update(reviewComments)
      .set({ comment: body.comment })
      .where(eq(reviewComments.id, params.id));

    return db.query.reviewComments.findFirst({
      where: eq(reviewComments.id, params.id),
    });
  }, {
    params: t.Object({ sessionId: t.String(), id: t.String() }),
    body: t.Object({ comment: t.String() }),
  })

  // Delete comment
  .delete('/:id', async ({ user, params, set }) => {
    const comment = await db.query.reviewComments.findFirst({
      where: eq(reviewComments.id, params.id),
      with: { session: true },
    });

    if (!comment || comment.session.userId !== user!.id) {
      set.status = 404;
      return { error: 'Comment not found' };
    }

    if (comment.status !== 'pending') {
      set.status = 400;
      return { error: 'Can only delete pending comments' };
    }

    await db.delete(reviewComments).where(eq(reviewComments.id, params.id));
    return { success: true };
  }, {
    params: t.Object({ sessionId: t.String(), id: t.String() }),
  })

  // Proceed - create batch and return formatted message
  .post('/proceed', async ({ user, params, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.sessionId),
        eq(claudeSessions.userId, user!.id)
      ),
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    const pendingComments = await db.query.reviewComments.findMany({
      where: and(
        eq(reviewComments.sessionId, params.sessionId),
        eq(reviewComments.status, 'pending')
      ),
      orderBy: (c, { asc }) => [asc(c.filePath), asc(c.lineNumber)],
    });

    if (pendingComments.length === 0) {
      set.status = 400;
      return { error: 'No pending comments to process' };
    }

    const batchId = nanoid();

    // Update all pending comments with batch ID and running status
    await db.update(reviewComments)
      .set({ batchId, status: 'running' })
      .where(and(
        eq(reviewComments.sessionId, params.sessionId),
        eq(reviewComments.status, 'pending')
      ));

    // Format message for Claude
    const message = formatClaudeMessage(pendingComments, batchId);

    return {
      batchId,
      message,
      commentCount: pendingComments.length,
    };
  }, {
    params: t.Object({ sessionId: t.String() }),
  })

  // List batches
  .get('/batches', async ({ user, params }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.sessionId),
        eq(claudeSessions.userId, user!.id)
      ),
    });

    if (!session) return [];

    const comments = await db.query.reviewComments.findMany({
      where: and(
        eq(reviewComments.sessionId, params.sessionId),
        // Only get comments that have a batch ID
      ),
    });

    // Group by batchId
    const batches = new Map<string, {
      batchId: string;
      status: string;
      count: number;
      createdAt: Date;
      resolvedAt: Date | null;
    }>();

    for (const comment of comments) {
      if (!comment.batchId) continue;

      if (!batches.has(comment.batchId)) {
        batches.set(comment.batchId, {
          batchId: comment.batchId,
          status: comment.status,
          count: 0,
          createdAt: comment.createdAt,
          resolvedAt: comment.resolvedAt,
        });
      }

      const batch = batches.get(comment.batchId)!;
      batch.count++;
    }

    return Array.from(batches.values()).sort((a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime()
    );
  }, {
    params: t.Object({ sessionId: t.String() }),
  })

  // Resolve batch
  .post('/batches/:batchId/resolve', async ({ user, params, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.sessionId),
        eq(claudeSessions.userId, user!.id)
      ),
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    await db.update(reviewComments)
      .set({ status: 'resolved', resolvedAt: new Date() })
      .where(and(
        eq(reviewComments.sessionId, params.sessionId),
        eq(reviewComments.batchId, params.batchId)
      ));

    return { success: true };
  }, {
    params: t.Object({ sessionId: t.String(), batchId: t.String() }),
  })

  // Rerun batch - clone as new pending comments
  .post('/batches/:batchId/rerun', async ({ user, params, set }) => {
    const session = await db.query.claudeSessions.findFirst({
      where: and(
        eq(claudeSessions.id, params.sessionId),
        eq(claudeSessions.userId, user!.id)
      ),
    });

    if (!session) {
      set.status = 404;
      return { error: 'Session not found' };
    }

    const batchComments = await db.query.reviewComments.findMany({
      where: and(
        eq(reviewComments.sessionId, params.sessionId),
        eq(reviewComments.batchId, params.batchId)
      ),
    });

    if (batchComments.length === 0) {
      set.status = 404;
      return { error: 'Batch not found' };
    }

    // Create new pending copies
    const newComments = batchComments.map(c => ({
      id: nanoid(),
      sessionId: c.sessionId,
      filePath: c.filePath,
      lineNumber: c.lineNumber,
      lineSide: c.lineSide,
      lineContent: c.lineContent,
      fileSha: c.fileSha,
      comment: c.comment,
      status: 'pending' as const,
    }));

    await db.insert(reviewComments).values(newComments);

    return {
      success: true,
      count: newComments.length,
    };
  }, {
    params: t.Object({ sessionId: t.String(), batchId: t.String() }),
  });

// Helper function to format Claude message
function formatClaudeMessage(comments: typeof reviewComments.$inferSelect[], batchId: string): string {
  const grouped = new Map<string, typeof comments>();

  for (const comment of comments) {
    if (!grouped.has(comment.filePath)) {
      grouped.set(comment.filePath, []);
    }
    grouped.get(comment.filePath)!.push(comment);
  }

  let message = 'Please make the following code review changes:\n\n';

  for (const [filePath, fileComments] of grouped) {
    message += `## ${filePath}\n\n`;

    for (const comment of fileComments) {
      const sideLabel = comment.lineSide === 'additions' ? 'addition' : 'deletion';
      message += `**Line ${comment.lineNumber} (${sideLabel}):**\n`;
      message += '```\n' + comment.lineContent + '\n```\n';
      message += `> ${comment.comment}\n\n`;
    }
  }

  message += `---\nBatch ID: ${batchId}\n`;

  return message;
}
```

**Step 2: Add relation to schema**

In `packages/api/src/db/schema.ts`, add after the table definition:

```typescript
export const reviewCommentsRelations = relations(reviewComments, ({ one }) => ({
  session: one(claudeSessions, {
    fields: [reviewComments.sessionId],
    references: [claudeSessions.id],
  }),
}));
```

**Step 3: Register routes**

In `packages/api/src/routes/index.ts`, add:

```typescript
import { reviewCommentsRoutes } from './review-comments.routes';

// Add to the api Elysia chain:
.use(reviewCommentsRoutes)
```

**Step 4: Commit**

```bash
git add packages/api/src/routes/review-comments.routes.ts packages/api/src/routes/index.ts packages/api/src/db/schema.ts
git commit -m "feat(api): add review comments CRUD and batch endpoints"
```

---

## Task 4: Frontend API Client

**Files:**
- Modify: `packages/ui/src/lib/api.ts`

**Step 1: Add TypeScript interfaces**

Add after existing interfaces:

```typescript
export type LineSide = 'additions' | 'deletions';
export type ReviewCommentStatus = 'pending' | 'running' | 'resolved';

export interface ReviewComment {
  id: string;
  sessionId: string;
  batchId: string | null;
  filePath: string;
  lineNumber: number;
  lineSide: LineSide;
  lineContent: string;
  fileSha: string | null;
  comment: string;
  status: ReviewCommentStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export interface CreateReviewCommentInput {
  filePath: string;
  lineNumber: number;
  lineSide: LineSide;
  lineContent: string;
  fileSha?: string;
  comment: string;
}

export interface ReviewBatch {
  batchId: string;
  status: ReviewCommentStatus;
  count: number;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ProceedResponse {
  batchId: string;
  message: string;
  commentCount: number;
}
```

**Step 2: Add API methods**

Add to the `api` object:

```typescript
  // Review Comments
  getReviewComments: (sessionId: string, status?: ReviewCommentStatus, batchId?: string) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (batchId) params.set('batchId', batchId);
    const query = params.toString();
    return request<ReviewComment[]>(`/sessions/${sessionId}/review-comments${query ? '?' + query : ''}`);
  },
  createReviewComment: (sessionId: string, data: CreateReviewCommentInput) =>
    request<ReviewComment>(`/sessions/${sessionId}/review-comments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateReviewComment: (sessionId: string, id: string, comment: string) =>
    request<ReviewComment>(`/sessions/${sessionId}/review-comments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ comment }),
    }),
  deleteReviewComment: (sessionId: string, id: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/review-comments/${id}`, {
      method: 'DELETE',
    }),
  proceedReviewComments: (sessionId: string) =>
    request<ProceedResponse>(`/sessions/${sessionId}/review-comments/proceed`, {
      method: 'POST',
    }),
  getReviewBatches: (sessionId: string) =>
    request<ReviewBatch[]>(`/sessions/${sessionId}/review-comments/batches`),
  resolveReviewBatch: (sessionId: string, batchId: string) =>
    request<{ success: boolean }>(`/sessions/${sessionId}/review-comments/batches/${batchId}/resolve`, {
      method: 'POST',
    }),
  rerunReviewBatch: (sessionId: string, batchId: string) =>
    request<{ success: boolean; count: number }>(`/sessions/${sessionId}/review-comments/batches/${batchId}/rerun`, {
      method: 'POST',
    }),
```

**Step 3: Commit**

```bash
git add packages/ui/src/lib/api.ts
git commit -m "feat(ui): add review comments API client methods"
```

---

## Task 5: Review Comment Hook

**Files:**
- Create: `packages/ui/src/hooks/useReviewComments.ts`

**Step 1: Create the hook**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, CreateReviewCommentInput, ReviewCommentStatus } from '@/lib/api';

export function useReviewComments(sessionId: string) {
  const queryClient = useQueryClient();

  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['review-comments', sessionId],
    queryFn: () => api.getReviewComments(sessionId),
    refetchInterval: 5000,
  });

  const { data: batches = [] } = useQuery({
    queryKey: ['review-batches', sessionId],
    queryFn: () => api.getReviewBatches(sessionId),
  });

  const pendingComments = comments.filter(c => c.status === 'pending');
  const runningComments = comments.filter(c => c.status === 'running');
  const resolvedComments = comments.filter(c => c.status === 'resolved');

  const createMutation = useMutation({
    mutationFn: (data: CreateReviewCommentInput) => api.createReviewComment(sessionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-comments', sessionId] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) =>
      api.updateReviewComment(sessionId, id, comment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-comments', sessionId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteReviewComment(sessionId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-comments', sessionId] });
    },
  });

  const proceedMutation = useMutation({
    mutationFn: () => api.proceedReviewComments(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-comments', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['review-batches', sessionId] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (batchId: string) => api.resolveReviewBatch(sessionId, batchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-comments', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['review-batches', sessionId] });
    },
  });

  const rerunMutation = useMutation({
    mutationFn: (batchId: string) => api.rerunReviewBatch(sessionId, batchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-comments', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['review-batches', sessionId] });
    },
  });

  return {
    comments,
    pendingComments,
    runningComments,
    resolvedComments,
    batches,
    isLoading,
    createComment: createMutation.mutate,
    updateComment: updateMutation.mutate,
    deleteComment: deleteMutation.mutate,
    proceed: proceedMutation.mutateAsync,
    resolveBatch: resolveMutation.mutate,
    rerunBatch: rerunMutation.mutate,
    isProceedPending: proceedMutation.isPending,
  };
}
```

**Step 2: Commit**

```bash
git add packages/ui/src/hooks/useReviewComments.ts
git commit -m "feat(ui): add useReviewComments hook for state management"
```

---

## Task 6: Review Comment Input Component

**Files:**
- Create: `packages/ui/src/components/ReviewCommentInput.tsx`

**Step 1: Create the component**

```typescript
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
```

**Step 2: Commit**

```bash
git add packages/ui/src/components/ReviewCommentInput.tsx
git commit -m "feat(ui): add ReviewCommentInput popover component"
```

---

## Task 7: Review Comment Annotation Component

**Files:**
- Create: `packages/ui/src/components/ReviewCommentAnnotation.tsx`

**Step 1: Create the component**

```typescript
import { MessageSquare, Loader2, Check, AlertCircle } from 'lucide-react';
import { ReviewComment, ReviewCommentStatus } from '@/lib/api';
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
```

**Step 2: Commit**

```bash
git add packages/ui/src/components/ReviewCommentAnnotation.tsx
git commit -m "feat(ui): add ReviewCommentAnnotation inline display component"
```

---

## Task 8: Review Batch Panel Component

**Files:**
- Create: `packages/ui/src/components/ReviewBatchPanel.tsx`

**Step 1: Create the component**

```typescript
import { useState } from 'react';
import { X, ChevronDown, ChevronRight, RotateCcw, Clock } from 'lucide-react';
import { ReviewBatch, ReviewComment } from '@/lib/api';
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
```

**Step 2: Commit**

```bash
git add packages/ui/src/components/ReviewBatchPanel.tsx
git commit -m "feat(ui): add ReviewBatchPanel for batch history and re-run"
```

---

## Task 9: Integrate into GitDiffView

**Files:**
- Modify: `packages/ui/src/components/GitDiffView.tsx`

**Step 1: Add imports and state**

Add to imports:

```typescript
import { useState, useMemo, useCallback } from 'react';
import { DiffLineAnnotation } from '@pierre/diffs';
import { useReviewComments } from '@/hooks/useReviewComments';
import { ReviewCommentInput } from './ReviewCommentInput';
import { ReviewCommentAnnotation } from './ReviewCommentAnnotation';
import { ReviewBatchPanel } from './ReviewBatchPanel';
import { MessageSquarePlus, History, Send } from 'lucide-react';
```

**Step 2: Add hook and state in component**

After props destructuring, add:

```typescript
const {
  comments,
  pendingComments,
  batches,
  createComment,
  deleteComment,
  proceed,
  rerunBatch,
  isProceedPending,
} = useReviewComments(sessionId);

const [showBatchPanel, setShowBatchPanel] = useState(false);
const [commentPopover, setCommentPopover] = useState<{
  lineNumber: number;
  side: 'additions' | 'deletions';
  lineContent: string;
  filePath: string;
  position: { x: number; y: number };
} | null>(null);
```

**Step 3: Add annotation rendering**

Add this function before the return:

```typescript
const lineAnnotations: DiffLineAnnotation<string>[] = useMemo(() => {
  if (!selectedFile) return [];
  return comments
    .filter(c => c.filePath === selectedFile)
    .map(c => ({
      lineNumber: c.lineNumber,
      side: c.lineSide,
      metadata: c.id,
    }));
}, [comments, selectedFile]);

const renderAnnotation = useCallback((annotation: DiffLineAnnotation<string>) => {
  const comment = comments.find(c => c.id === annotation.metadata);
  if (!comment) return null;
  return (
    <ReviewCommentAnnotation
      comment={comment}
      onDelete={deleteComment}
    />
  );
}, [comments, deleteComment]);

const renderHoverUtility = useCallback((getHoveredLine: () => { lineNumber: number; side: 'additions' | 'deletions' } | undefined) => {
  const hovered = getHoveredLine();
  if (!hovered) return null;

  return (
    <button
      onClick={(e) => {
        const rect = (e.target as HTMLElement).getBoundingClientRect();
        setCommentPopover({
          lineNumber: hovered.lineNumber,
          side: hovered.side,
          lineContent: '', // Will need to extract from diff
          filePath: selectedFile || '',
          position: { x: rect.right + 10, y: rect.top },
        });
      }}
      className="p-1 rounded hover:bg-accent"
      title="Add comment"
    >
      <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}, [selectedFile]);

const handleAddComment = useCallback(async (comment: string) => {
  if (!commentPopover) return;

  createComment({
    filePath: commentPopover.filePath,
    lineNumber: commentPopover.lineNumber,
    lineSide: commentPopover.side,
    lineContent: commentPopover.lineContent,
    comment,
  });

  setCommentPopover(null);
}, [commentPopover, createComment]);

const handleProceed = useCallback(async () => {
  const result = await proceed();
  // Insert message into Claude terminal - you'll need to implement this integration
  console.log('Proceed result:', result);
  // TODO: Insert result.message into Claude terminal input
}, [proceed]);
```

**Step 4: Update header with buttons**

In the header section, add after the refresh button:

```typescript
{pendingComments.length > 0 && (
  <Button
    variant="default"
    size="sm"
    onClick={handleProceed}
    disabled={isProceedPending}
    className="h-7 text-xs"
  >
    <Send className="h-3.5 w-3.5 mr-1" />
    Proceed ({pendingComments.length})
  </Button>
)}
<Button
  variant="ghost"
  size="sm"
  onClick={() => setShowBatchPanel(true)}
  className="h-7 w-7 p-0"
  title="Review history"
>
  <History className="h-3.5 w-3.5" />
</Button>
```

**Step 5: Update PatchDiff and FileDiff props**

Update the PatchDiff component to include annotations:

```typescript
<PatchDiff
  patch={diffData.diff}
  options={{
    theme: { dark: 'github-dark', light: 'github-light' },
    diffStyle: 'unified',
    enableLineSelection: true,
    enableHoverUtility: true,
  }}
  lineAnnotations={lineAnnotations}
  renderAnnotation={renderAnnotation}
  renderHoverUtility={renderHoverUtility}
/>
```

**Step 6: Add popover and panel**

Before the closing div of the component, add:

```typescript
{commentPopover && (
  <div
    className="fixed z-50"
    style={{ left: commentPopover.position.x, top: commentPopover.position.y }}
  >
    <ReviewCommentInput
      onSubmit={handleAddComment}
      onCancel={() => setCommentPopover(null)}
      existingComments={comments
        .filter(c =>
          c.filePath === commentPopover.filePath &&
          c.lineNumber === commentPopover.lineNumber &&
          c.status === 'pending'
        )
        .map(c => ({ id: c.id, comment: c.comment }))}
    />
  </div>
)}

{showBatchPanel && (
  <ReviewBatchPanel
    batches={batches}
    comments={comments}
    onRerun={rerunBatch}
    onClose={() => setShowBatchPanel(false)}
  />
)}
```

**Step 7: Commit**

```bash
git add packages/ui/src/components/GitDiffView.tsx
git commit -m "feat(ui): integrate review comments into GitDiffView"
```

---

## Task 10: Terminal Integration for Proceed Message

**Files:**
- Modify: `packages/ui/src/pages/Session.tsx`

**Step 1: Add context or callback for terminal input**

This task requires creating a way to insert text into the Claude terminal. The specific implementation depends on how the terminal component exposes its API.

Look for the terminal ref or input handler and expose a method like:

```typescript
const insertTerminalInput = useCallback((text: string) => {
  // Find the Claude terminal and insert text
  // This depends on your terminal implementation
}, []);
```

**Step 2: Pass this to GitDiffView or use context**

Either pass as prop or create a context to share the terminal input functionality.

**Step 3: Commit**

```bash
git add packages/ui/src/pages/Session.tsx
git commit -m "feat(ui): add terminal integration for inserting proceed message"
```

---

## Summary

After completing all tasks:

1. **Database**: New `review_comments` table with status tracking and batch IDs
2. **API**: Full CRUD + batch operations under `/sessions/:id/review-comments`
3. **Frontend**: Hook, input, annotation, and panel components
4. **Integration**: GitDiffView with `@pierre/diffs` annotation API

Test by:
1. Opening a session with git changes
2. Clicking a line to add a comment
3. Adding multiple comments
4. Clicking "Proceed" to batch them
5. Checking the History panel
6. Re-running a batch
