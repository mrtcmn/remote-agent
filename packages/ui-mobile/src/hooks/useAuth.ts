import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, clearAuthCookie } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useEffect } from 'react';

export function useAuth() {
  const { setUser, setLoading } = useAuthStore();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: api.getMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!isLoading) {
      setUser(data?.user ?? null);
      setLoading(false);
    }
  }, [data, isLoading]);

  const setPinMutation = useMutation({
    mutationFn: (pin: string) => api.setPin(pin),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth'] }),
  });

  const verifyPinMutation = useMutation({
    mutationFn: (pin: string) => api.verifyPin(pin),
  });

  const logout = async () => {
    await clearAuthCookie();
    setUser(null);
    queryClient.clear();
  };

  return {
    user: data?.user ?? null,
    isLoading,
    error,
    setPin: setPinMutation.mutateAsync,
    verifyPin: verifyPinMutation.mutateAsync,
    logout,
  };
}
