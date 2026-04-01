import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useGitHubApps() {
  return useQuery({
    queryKey: ['github-apps'],
    queryFn: api.getGitHubApps,
  });
}

export function useGitHubAppInstallations(appId: string | undefined) {
  return useQuery({
    queryKey: ['github-app-installations', appId],
    queryFn: () => api.getGitHubAppInstallations(appId!),
    enabled: !!appId,
  });
}

export function useInstallationRepos(installationId: string | undefined) {
  return useQuery({
    queryKey: ['installation-repos', installationId],
    queryFn: () => api.getInstallationRepos(installationId!),
    enabled: !!installationId,
  });
}

export function useGitHubOAuthStatus() {
  return useQuery({
    queryKey: ['github-oauth-status'],
    queryFn: api.getGitHubOAuthStatus,
  });
}

export function useDeleteGitHubApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, pin }: { id: string; pin?: string }) => api.deleteGitHubApp(id, pin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github-apps'] });
    },
  });
}

export function useSetDefaultGitHubApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.setDefaultGitHubApp(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github-apps'] });
    },
  });
}

export function useSyncInstallations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (appId: string) => api.syncGitHubAppInstallations(appId),
    onSuccess: (_data, appId) => {
      queryClient.invalidateQueries({ queryKey: ['github-app-installations', appId] });
    },
  });
}
