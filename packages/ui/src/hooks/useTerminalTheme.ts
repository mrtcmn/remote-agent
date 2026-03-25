import { useCallback, useSyncExternalStore } from 'react';
import themeData from '@/lib/terminal-themes.json';
import type { ITheme } from 'xterm';

export interface TerminalThemeEntry {
  id: string;
  name: string;
  type: 'dark' | 'light';
  theme: ITheme;
}

const STORAGE_KEY = 'terminal-theme-id';
const allThemes = themeData.themes as TerminalThemeEntry[];
const DEFAULT_THEME_ID = 'dark-default';

// Simple event-based store so all terminals react to theme changes
const listeners = new Set<() => void>();
let currentThemeId = localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME_ID;

function getThemeId() {
  return currentThemeId;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function setThemeId(id: string) {
  currentThemeId = id;
  localStorage.setItem(STORAGE_KEY, id);
  listeners.forEach((cb) => cb());
}

export function getTerminalTheme(id?: string): TerminalThemeEntry {
  const target = id || currentThemeId;
  return allThemes.find((t) => t.id === target) || allThemes[0];
}

export function useTerminalTheme() {
  const themeId = useSyncExternalStore(subscribe, getThemeId, getThemeId);
  const activeTheme = getTerminalTheme(themeId);

  const setTheme = useCallback((id: string) => {
    setThemeId(id);
  }, []);

  return {
    themes: allThemes,
    darkThemes: allThemes.filter((t) => t.type === 'dark'),
    lightThemes: allThemes.filter((t) => t.type === 'light'),
    activeTheme,
    setTheme,
  };
}
