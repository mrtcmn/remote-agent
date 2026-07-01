import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type UpdateRunFlowInput } from '@/lib/api';

export function useRunFlowList(projectId?: string) {
  const { data: flows = [], isLoading } = useQuery({
    queryKey: ['runFlows', projectId],
    queryFn: () => api.listRunFlows(projectId!),
    enabled: !!projectId,
  });

  return { flows, isLoading };
}

export function useRunFlow(flowId?: string) {
  const queryClient = useQueryClient();

  const { data: flow, isLoading } = useQuery({
    queryKey: ['runFlow', flowId],
    queryFn: () => api.getRunFlow(flowId!),
    enabled: !!flowId,
  });

  const anyRunning = useMemo(() => {
    return (flow?.nodes ?? []).some((n) => n.runConfig?.isRunning);
  }, [flow]);

  const { data: status = [] } = useQuery({
    queryKey: ['runFlow', flowId, 'status'],
    queryFn: () => api.getFlowStatus(flowId!),
    enabled: !!flowId,
    refetchInterval: anyRunning ? 2000 : 5000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['runFlow', flowId] });
  };

  const update = useMutation({
    mutationFn: (data: UpdateRunFlowInput) => api.updateRunFlow(flowId!, data),
    onSuccess: invalidate,
  });

  const runAll = useMutation({
    mutationFn: (sessionId: string) => api.runFlow(flowId!, sessionId),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['terminals'] });
      queryClient.invalidateQueries({ queryKey: ['runConfigs'] });
    },
  });

  const stopAll = useMutation({
    mutationFn: () => api.stopFlow(flowId!),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['terminals'] });
      queryClient.invalidateQueries({ queryKey: ['runConfigs'] });
    },
  });

  return {
    flow,
    status,
    isLoading,
    update: update.mutateAsync,
    isUpdating: update.isPending,
    runAll: runAll.mutateAsync,
    isRunning: runAll.isPending,
    stopAll: stopAll.mutateAsync,
    isStopping: stopAll.isPending,
  };
}
