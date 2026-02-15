import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type KanbanStatus, type CreateTaskInput, type UpdateTaskInput, type TaskFiltersInput } from '@/lib/api';

export function useKanbanBoard(projectId?: string) {
  return useQuery({
    queryKey: ['kanban', 'board', projectId],
    queryFn: () => api.getKanbanBoard(projectId),
    refetchInterval: 10000,
  });
}

export function useKanbanTasks(filters?: TaskFiltersInput) {
  return useQuery({
    queryKey: ['kanban', 'tasks', filters],
    queryFn: () => api.getKanbanTasks(filters),
    refetchInterval: 10000,
  });
}

export function useKanbanTask(taskId: string | null) {
  return useQuery({
    queryKey: ['kanban', 'task', taskId],
    queryFn: () => api.getKanbanTask(taskId!),
    enabled: !!taskId,
  });
}

export function useTaskComments(taskId: string | null) {
  return useQuery({
    queryKey: ['kanban', 'comments', taskId],
    queryFn: () => api.getTaskComments(taskId!),
    enabled: !!taskId,
  });
}

export function useAutoFlows(projectId?: string) {
  return useQuery({
    queryKey: ['kanban', 'flows', projectId],
    queryFn: () => api.getAutoFlows(projectId),
  });
}

export function useCLIAdapters() {
  return useQuery({
    queryKey: ['kanban', 'adapters'],
    queryFn: api.getCLIAdapters,
    staleTime: 60000,
  });
}

export function useKanbanMutations() {
  const queryClient = useQueryClient();

  const invalidateBoard = () => {
    queryClient.invalidateQueries({ queryKey: ['kanban'] });
  };

  const createTask = useMutation({
    mutationFn: (data: CreateTaskInput) => api.createKanbanTask(data),
    onSuccess: invalidateBoard,
  });

  const updateTask = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTaskInput }) => api.updateKanbanTask(id, data),
    onSuccess: invalidateBoard,
  });

  const moveTask = useMutation({
    mutationFn: ({ id, status, position }: { id: string; status: KanbanStatus; position: number }) =>
      api.moveKanbanTask(id, status, position),
    onSuccess: invalidateBoard,
  });

  const deleteTask = useMutation({
    mutationFn: (id: string) => api.deleteKanbanTask(id),
    onSuccess: invalidateBoard,
  });

  const addComment = useMutation({
    mutationFn: ({ taskId, content, parentCommentId }: { taskId: string; content: string; parentCommentId?: string }) =>
      api.addTaskComment(taskId, content, parentCommentId),
    onSuccess: invalidateBoard,
  });

  const resolveComment = useMutation({
    mutationFn: (commentId: string) => api.resolveTaskComment(commentId),
    onSuccess: invalidateBoard,
  });

  const rejectComment = useMutation({
    mutationFn: (commentId: string) => api.rejectTaskComment(commentId),
    onSuccess: invalidateBoard,
  });

  const reopenComment = useMutation({
    mutationFn: (commentId: string) => api.reopenTaskComment(commentId),
    onSuccess: invalidateBoard,
  });

  const deleteComment = useMutation({
    mutationFn: (commentId: string) => api.deleteTaskComment(commentId),
    onSuccess: invalidateBoard,
  });

  const addDependency = useMutation({
    mutationFn: ({ taskId, dependsOnTaskId }: { taskId: string; dependsOnTaskId: string }) =>
      api.addTaskDependency(taskId, dependsOnTaskId),
    onSuccess: invalidateBoard,
  });

  const removeDependency = useMutation({
    mutationFn: (id: string) => api.removeTaskDependency(id),
    onSuccess: invalidateBoard,
  });

  const uploadAttachment = useMutation({
    mutationFn: ({ taskId, file, commentId }: { taskId: string; file: File; commentId?: string }) =>
      api.uploadTaskAttachment(taskId, file, commentId),
    onSuccess: invalidateBoard,
  });

  const deleteAttachment = useMutation({
    mutationFn: (id: string) => api.deleteTaskAttachment(id),
    onSuccess: invalidateBoard,
  });

  const createFlow = useMutation({
    mutationFn: (data: Parameters<typeof api.createAutoFlow>[0]) => api.createAutoFlow(data),
    onSuccess: invalidateBoard,
  });

  const updateFlow = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) => api.updateAutoFlow(id, data),
    onSuccess: invalidateBoard,
  });

  const deleteFlow = useMutation({
    mutationFn: (id: string) => api.deleteAutoFlow(id),
    onSuccess: invalidateBoard,
  });

  return {
    createTask, updateTask, moveTask, deleteTask,
    addComment, resolveComment, rejectComment, reopenComment, deleteComment,
    addDependency, removeDependency,
    uploadAttachment, deleteAttachment,
    createFlow, updateFlow, deleteFlow,
  };
}
