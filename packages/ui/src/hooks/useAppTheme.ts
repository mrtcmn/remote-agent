import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getTerminalTheme } from '@/hooks/useTerminalTheme';

export type AppThemeMode = 'dark' | 'light' | 'system' | 'terminal';

const STORAGE_KEY = 'app-theme-mode';
const listeners = new Set<() => void>();
let currentMode: AppThemeMode = (localStorage.getItem(STORAGE_KEY) as AppThemeMode) || 'dark';

function notify() {
  listeners.forEach((cb) => cb());
}

function getSnapshot() {
  return currentMode;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function setMode(mode: AppThemeMode) {
  currentMode = mode;
  localStorage.setItem(STORAGE_KEY, mode);
  applyTheme();
  notify();
}

function getResolvedTheme(): 'dark' | 'light' {
  switch (currentMode) {
    case 'dark':
      return 'dark';
    case 'light':
      return 'light';
    case 'system':
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    case 'terminal': {
      const termTheme = getTerminalTheme();
      return termTheme.type;
    }
  }
}

function applyTheme() {
  const resolved = getResolvedTheme();
  const root = document.documentElement;
  if (resolved === 'light') {
    root.classList.add('light');
    root.classList.remove('dark');
  } else {
    root.classList.add('dark');
    root.classList.remove('light');
  }
}

// Initialize on load
applyTheme();

// Listen for system preference changes
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentMode === 'system') {
      applyTheme();
      notify();
    }
  });
}

export function notifyAppTheme() {
  if (currentMode === 'terminal') {
    applyTheme();
    notify();
  }
}

export function useAppTheme() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, () => 'dark' as AppThemeMode);

  useEffect(() => {
    applyTheme();
  }, [mode]);

  return {
    mode,
    setMode: useCallback((m: AppThemeMode) => setMode(m), []),
    resolved: getResolvedTheme(),
  };
}
