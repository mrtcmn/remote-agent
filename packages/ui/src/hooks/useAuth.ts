import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type User } from '../lib/api';

export function useAuth() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: api.getMe,
    retry: false,
  });

  const setPinMutation = useMutation({
    mutationFn: api.setPin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });

  const verifyPinMutation = useMutation({
    mutationFn: api.verifyPin,
  });

  const logout = () => {
    // Clear auth cookies and redirect
    window.location.href = '/api/auth/signout';
  };

  return {
    user: data?.user as User | null,
    isLoading,
    error,
    setPin: setPinMutation.mutate,
    verifyPin: verifyPinMutation.mutateAsync,
    logout,
  };
}
