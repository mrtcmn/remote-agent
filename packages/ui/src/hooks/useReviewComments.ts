import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type CreateReviewCommentInput } from '../lib/api';

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
