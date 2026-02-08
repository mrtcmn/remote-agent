import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CreateProjectInput } from '../types';

export function useProjects() {
  const queryClient = useQueryClient();

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: api.getProjects,
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateProjectInput) => api.createProject(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, pin }: { id: string; pin: string }) =>
      api.deleteProject(id, pin),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  const fetchMutation = useMutation({
    mutationFn: (projectId: string) => api.gitFetch(projectId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  const pullMutation = useMutation({
    mutationFn: ({
      projectId,
      branch,
    }: {
      projectId: string;
      branch?: string;
    }) => api.gitPull(projectId, branch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  const pushMutation = useMutation({
    mutationFn: ({
      projectId,
      branch,
    }: {
      projectId: string;
      branch?: string;
    }) => api.gitPush(projectId, branch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  return {
    projects: projectsQuery.data ?? [],
    isLoading: projectsQuery.isLoading,
    error: projectsQuery.error,
    refetch: projectsQuery.refetch,
    createProject: createMutation.mutateAsync,
    deleteProject: deleteMutation.mutateAsync,
    gitFetch: fetchMutation.mutateAsync,
    gitPull: pullMutation.mutateAsync,
    gitPush: pushMutation.mutateAsync,
  };
}
