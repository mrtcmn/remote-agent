import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type CreateRunConfigInput, type UpdateRunConfigInput } from '@/lib/api';

export function useRunConfigs(projectId?: string) {
  const queryClient = useQueryClient();

  const { data: runConfigs = [], isLoading } = useQuery({
    queryKey: ['runConfigs', projectId],
    queryFn: () => api.getRunConfigs(projectId!),
    enabled: !!projectId,
    refetchInterval: 5000,
  });

  const { data: scripts } = useQuery({
    queryKey: ['runConfigs', 'scripts', projectId],
    queryFn: () => api.discoverScripts(projectId!),
    enabled: !!projectId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['runConfigs', projectId] });
  };

  const createMutation = useMutation({
    mutationFn: (data: CreateRunConfigInput) => api.createRunConfig(data),
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateRunConfigInput }) =>
      api.updateRunConfig(id, data),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteRunConfig(id),
    onSuccess: invalidate,
  });

  const startMutation = useMutation({
    mutationFn: ({ id, sessionId }: { id: string; sessionId: string }) =>
      api.startRunConfig(id, sessionId),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['terminals'] });
    },
  });

  const stopMutation = useMutation({
    mutationFn: (id: string) => api.stopRunConfig(id),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['terminals'] });
    },
  });

  const restartMutation = useMutation({
    mutationFn: ({ id, sessionId }: { id: string; sessionId: string }) =>
      api.restartRunConfig(id, sessionId),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['terminals'] });
    },
  });

  return {
    runConfigs,
    isLoading,
    scripts: scripts?.scripts || [],
    create: createMutation.mutateAsync,
    update: updateMutation.mutateAsync,
    remove: deleteMutation.mutateAsync,
    start: startMutation.mutateAsync,
    stop: stopMutation.mutateAsync,
    restart: restartMutation.mutateAsync,
    isStarting: startMutation.isPending,
    isStopping: stopMutation.isPending,
  };
}
