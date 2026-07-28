import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getTerminalTheme } from '@/hooks/useTerminalTheme';

export type AppThemeMode = 'dark' | 'light' | 'system' | 'terminal';

const STORAGE_KEY = 'app-theme-mode';
const listeners = new Set<() => void>();
// Default 'terminal': the terminal theme drives the whole app (base color +
// tint), so picking an xterm theme re-themes everything immediately.
let currentMode: AppThemeMode = (localStorage.getItem(STORAGE_KEY) as AppThemeMode) || 'terminal';

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

// ── Base-surface sync ────────────────────────────────────────────────────────
// The terminal theme's background becomes the app-wide base color, so the
// terminal pane and all chrome share one background and panels read as
// bordered boxes on that canvas. Surface/border tokens are re-derived from the
// base lightness; foreground colors stay with the light/dark class palette,
// which is why we only sync when the terminal theme type matches the resolved
// app theme (otherwise contrast would break — we fall back to the static palette).

function hexToHsl(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)];
}

const SYNCED_VARS = [
  '--background', '--card', '--sidebar', '--popover',
  '--secondary', '--muted', '--accent', '--sidebar-accent',
  '--border', '--input', '--sidebar-border',
];

function syncBaseFromTerminal(resolved: 'dark' | 'light') {
  const root = document.documentElement.style;
  const term = getTerminalTheme();
  const hsl = term.theme.background ? hexToHsl(term.theme.background) : null;
  if (!hsl || term.type !== resolved) {
    for (const v of SYNCED_VARS) root.removeProperty(v);
    return;
  }
  const [h, s, l] = hsl;
  const dark = resolved === 'dark';
  const set = (vars: string[], lum: number) => {
    const value = `${h} ${s}% ${Math.min(100, Math.max(0, lum))}%`;
    for (const v of vars) root.setProperty(v, value);
  };
  set(['--background'], l);
  // Boxes sit slightly darker than the base canvas
  set(['--card', '--sidebar'], dark ? l - 3 : l - 4);
  set(['--popover'], dark ? l + 4 : l);
  set(['--secondary', '--muted', '--accent', '--sidebar-accent'], dark ? l + 10 : l - 7);
  set(['--border', '--input', '--sidebar-border'], dark ? l + 10 : l - 14);
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
  syncBaseFromTerminal(resolved);
}

// Initialize on load (deferred to avoid circular import with useTerminalTheme)
queueMicrotask(applyTheme);

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
  // Always re-apply: the base surface tokens follow the terminal theme in
  // every mode, not just 'terminal'.
  applyTheme();
  if (currentMode === 'terminal') notify();
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
