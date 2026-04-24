import { create } from 'zustand';

const STORAGE_KEY = 'remote-agent.activeMachine';

interface ActiveMachineState {
  /** Machine id currently being viewed — 'self' for this machine, otherwise a paired master id. */
  machineId: string;
  name: string;
  setActive: (value: { machineId: string; name: string }) => void;
  reset: () => void;
}

interface StoredValue {
  machineId: string;
  name: string;
}

function readInitial(): StoredValue {
  if (typeof window === 'undefined') return { machineId: 'self', name: 'This machine' };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredValue>;
      if (parsed.machineId && parsed.name) {
        return { machineId: parsed.machineId, name: parsed.name };
      }
    }
  } catch { /* ignore */ }
  return { machineId: 'self', name: 'This machine' };
}

function persist(value: StoredValue) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch { /* ignore */ }
}

const initial = readInitial();

export const useActiveMachine = create<ActiveMachineState>((set) => ({
  machineId: initial.machineId,
  name: initial.name,
  setActive: ({ machineId, name }) => {
    persist({ machineId, name });
    set({ machineId, name });
  },
  reset: () => {
    persist({ machineId: 'self', name: 'This machine' });
    set({ machineId: 'self', name: 'This machine' });
  },
}));

/** Read the current active machine id without subscribing (e.g. in API request wrapper). */
export function getActiveMachineId(): string {
  return useActiveMachine.getState().machineId;
}

/**
 * Endpoints that always target the local machine even when a remote is selected.
 * These manage session cookies, local-only state, or the pairing relationship itself.
 */
const LOCAL_ONLY_PREFIXES = ['/auth', '/paired-masters'];

export function shouldProxyEndpoint(endpoint: string): boolean {
  const path = endpoint.split('?')[0];
  return !LOCAL_ONLY_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Resolve a WebSocket URL that respects the active machine. When viewing a remote,
 * routes through the local API's /ws/proxy/:machineId?path=... bridge so the master's
 * machineToken stays server-side. When viewing self, returns the path unchanged.
 */
export function resolveWsPath(wsPath: string): string {
  const activeId = getActiveMachineId();
  if (!activeId || activeId === 'self') return wsPath;
  const encoded = encodeURIComponent(wsPath);
  return `/ws/proxy/${activeId}?path=${encoded}`;
}
