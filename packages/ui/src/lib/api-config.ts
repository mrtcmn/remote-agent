import { create } from 'zustand';
import { getElectronAPI, isElectron } from './electron';

interface ApiConfigState {
  apiBaseUrl: string;
  wsBaseUrl: string;
  isConfigured: boolean;
  isLoading: boolean;
  setApiUrl: (url: string) => void;
  initialize: () => Promise<void>;
}

function deriveWsUrl(httpUrl: string): string {
  if (!httpUrl) return '';
  try {
    const u = new URL(httpUrl);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return u.origin;
  } catch {
    return '';
  }
}

export const useApiConfig = create<ApiConfigState>((set) => ({
  apiBaseUrl: '',
  wsBaseUrl: '',
  isConfigured: !isElectron(),
  isLoading: isElectron(),

  setApiUrl: (url: string) => {
    const cleaned = url.replace(/\/+$/, '');
    set({
      apiBaseUrl: cleaned,
      wsBaseUrl: deriveWsUrl(cleaned),
      isConfigured: !!cleaned,
    });
  },

  initialize: async () => {
    const electronAPI = getElectronAPI();
    if (!electronAPI) {
      set({ isLoading: false, isConfigured: true });
      return;
    }
    const saved = await electronAPI.getApiUrl();
    if (saved) {
      const cleaned = saved.replace(/\/+$/, '');
      set({
        apiBaseUrl: cleaned,
        wsBaseUrl: deriveWsUrl(cleaned),
        isConfigured: true,
        isLoading: false,
      });
    } else {
      set({ isLoading: false, isConfigured: false });
    }
  },
}));

export function getApiBase(): string {
  return useApiConfig.getState().apiBaseUrl;
}

export function getWsBase(): string {
  return useApiConfig.getState().wsBaseUrl;
}
