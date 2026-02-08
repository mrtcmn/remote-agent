import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useSessions() {
  const queryClient = useQueryClient();

  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: api.getSessions,
    refetchInterval: 5000,
  });

  const createMutation = useMutation({
    mutationFn: (projectId?: string) => api.createSession(projectId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });

  const terminateMutation = useMutation({
    mutationFn: (id: string) => api.terminateSession(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });

  return {
    sessions: sessionsQuery.data ?? [],
    isLoading: sessionsQuery.isLoading,
    error: sessionsQuery.error,
    refetch: sessionsQuery.refetch,
    createSession: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    terminateSession: terminateMutation.mutateAsync,
  };
}

export function useSession(id: string) {
  return useQuery({
    queryKey: ['session', id],
    queryFn: () => api.getSession(id),
    refetchInterval: 5000,
    enabled: !!id,
  });
}

export function useSessionTerminals(sessionId: string) {
  const queryClient = useQueryClient();

  const terminalsQuery = useQuery({
    queryKey: ['terminals', sessionId],
    queryFn: () => api.getSessionTerminals(sessionId),
    refetchInterval: 5000,
    enabled: !!sessionId,
  });

  const createTerminalMutation = useMutation({
    mutationFn: api.createTerminal,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['terminals', sessionId] }),
  });

  const closeTerminalMutation = useMutation({
    mutationFn: (terminalId: string) => api.closeTerminal(terminalId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['terminals', sessionId] }),
  });

  return {
    terminals: terminalsQuery.data ?? [],
    isLoading: terminalsQuery.isLoading,
    createTerminal: createTerminalMutation.mutateAsync,
    closeTerminal: closeTerminalMutation.mutateAsync,
    refetch: terminalsQuery.refetch,
  };
}
