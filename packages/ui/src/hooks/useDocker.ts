import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useDocker(projectId?: string, sessionId?: string) {
  const queryClient = useQueryClient();

  const invalidateContainers = () => {
    queryClient.invalidateQueries({ queryKey: ['docker-containers'] });
  };

  const { data: containersData, isLoading: isLoadingContainers } = useQuery({
    queryKey: ['docker-containers'],
    queryFn: () => api.getDockerContainers(),
    refetchInterval: 5000,
  });

  const { data: dockerFiles, isLoading: isLoadingFiles } = useQuery({
    queryKey: ['docker-files', projectId],
    queryFn: () => api.detectDockerFiles(projectId!),
    enabled: !!projectId,
  });

  const { data: attachmentsData } = useQuery({
    queryKey: ['docker-attachments', sessionId],
    queryFn: () => api.getDockerAttachments(sessionId!),
    enabled: !!sessionId,
  });

  const invalidateAttachments = () => {
    queryClient.invalidateQueries({ queryKey: ['docker-attachments', sessionId] });
    queryClient.invalidateQueries({ queryKey: ['sidebar-aggregate'] });
  };

  const { data: dockerStatus } = useQuery({
    queryKey: ['docker-status'],
    queryFn: () => api.getDockerStatus(),
    staleTime: 60_000,
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => api.startDockerContainer(id),
    onSuccess: invalidateContainers,
  });

  const stopMutation = useMutation({
    mutationFn: (id: string) => api.stopDockerContainer(id),
    onSuccess: invalidateContainers,
  });

  const restartMutation = useMutation({
    mutationFn: (id: string) => api.restartDockerContainer(id),
    onSuccess: invalidateContainers,
  });

  const removeMutation = useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) =>
      api.removeDockerContainer(id, force),
    onSuccess: invalidateContainers,
  });

  const logsMutation = useMutation({
    mutationFn: ({ containerId, sessionId }: { containerId: string; sessionId: string }) =>
      api.viewContainerLogs(containerId, sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['terminals'] });
    },
  });

  const runMutation = useMutation({
    mutationFn: (data: { image: string; name?: string; ports?: string[]; env?: Record<string, string> }) =>
      api.dockerRun({ ...data, sessionId }),
    onSuccess: invalidateContainers,
  });

  const buildMutation = useMutation({
    mutationFn: (data: { dockerfilePath: string; contextDir: string; tag?: string }) =>
      api.dockerBuild(data.dockerfilePath, data.contextDir, data.tag, sessionId),
    onSuccess: invalidateContainers,
  });

  const composeUpMutation = useMutation({
    mutationFn: (composePath: string) => api.dockerComposeUp(composePath, sessionId),
    onSuccess: () => {
      invalidateContainers();
      invalidateAttachments();
    },
  });

  const composeDownMutation = useMutation({
    mutationFn: (composePath: string) => api.dockerComposeDown(composePath, sessionId),
    onSuccess: invalidateContainers,
  });

  const attachMutation = useMutation({
    mutationFn: (containerName: string) => api.attachDockerContainer(sessionId!, containerName),
    onSuccess: invalidateAttachments,
  });

  const detachMutation = useMutation({
    mutationFn: (containerName: string) => api.detachDockerContainer(sessionId!, containerName),
    onSuccess: invalidateAttachments,
  });

  return {
    containers: containersData?.containers || [],
    dockerFiles: dockerFiles?.files || [],
    attachments: attachmentsData?.attachments || [],
    isAvailable: dockerStatus?.available ?? false,
    isLoadingContainers,
    isLoadingFiles,
    start: startMutation.mutateAsync,
    stop: stopMutation.mutateAsync,
    restart: restartMutation.mutateAsync,
    remove: removeMutation.mutateAsync,
    viewLogs: logsMutation.mutateAsync,
    run: runMutation.mutateAsync,
    build: buildMutation.mutateAsync,
    attach: attachMutation.mutateAsync,
    detach: detachMutation.mutateAsync,
    composeUp: composeUpMutation.mutateAsync,
    composeDown: composeDownMutation.mutateAsync,
    isRunning: runMutation.isPending,
    isBuilding: buildMutation.isPending,
  };
}
