import { create } from 'zustand';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  serverUrl: string;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  setServerUrl: (url: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  serverUrl: '',
  setUser: (user) => set({ user, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
  setServerUrl: (serverUrl) => set({ serverUrl }),
  logout: () => set({ user: null }),
}));
