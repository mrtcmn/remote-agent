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
  const configured = useApiConfig.getState().apiBaseUrl;
  if (!configured) return '';
  // If configured URL matches the current page origin, use relative URLs
  // so requests go through the same origin (e.g. vite proxy in dev)
  try {
    const configuredOrigin = new URL(configured).origin;
    if (configuredOrigin === window.location.origin) return '';
  } catch {
    // invalid URL, return as-is
  }
  return configured;
}

export function getWsBase(): string {
  const configured = useApiConfig.getState().wsBaseUrl;
  if (!configured) return '';
  // If configured WS URL matches the current page origin, use relative WS
  // so connections go through the same origin (e.g. vite proxy in dev)
  try {
    const configuredOrigin = new URL(configured).origin;
    const pageWsOrigin = window.location.origin.replace(/^http/, 'ws');
    if (configuredOrigin === pageWsOrigin) return '';
  } catch {
    // invalid URL, return as-is
  }
  return configured;
}
