import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type VersionInfo } from '../lib/api';

export function useVersion() {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['version'],
    queryFn: () => api.getVersion(false),
    staleTime: 4 * 60 * 60 * 1000, // 4 hours
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const forceCheck = async () => {
    const result = await api.getVersion(true);
    queryClient.setQueryData(['version'], result);
    return result;
  };

  return {
    version: data as VersionInfo | undefined,
    isLoading,
    error,
    refetch,
    forceCheck,
  };
}
