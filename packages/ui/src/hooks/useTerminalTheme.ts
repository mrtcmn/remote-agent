import { useCallback, useSyncExternalStore } from 'react';
import themeData from '@/lib/terminal-themes.json';
import type { ITheme } from 'xterm';
import { notifyAppTheme } from '@/hooks/useAppTheme';

export interface TerminalThemeEntry {
  id: string;
  name: string;
  type: 'dark' | 'light';
  theme: ITheme;
}

export interface TerminalFont {
  id: string;
  name: string;
  family: string;
  weights: number[];
}

export const FONTS: TerminalFont[] = [
  {
    id: 'fira-code',
    name: 'Fira Code Retina',
    family: '"Fira Code Retina", "Fira Code", monospace',
    weights: [400, 500, 600, 700],
  },
  {
    id: 'jetbrains-mono',
    name: 'JetBrains Mono',
    family: '"JetBrains Mono", monospace',
    weights: [400, 500, 600, 700],
  },
];

const STORAGE_KEY = 'terminal-theme-id';
const FONT_STORAGE_KEY = 'terminal-font-id';
const WEIGHT_STORAGE_KEY = 'terminal-font-weight';
const FONTSIZE_STORAGE_KEY = 'terminal-font-size';

const allThemes = themeData.themes as TerminalThemeEntry[];
const DEFAULT_THEME_ID = 'dark-default';
const DEFAULT_FONT_ID = 'fira-code';
const DEFAULT_WEIGHT = 500;
const isMobile = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
const DEFAULT_FONT_SIZE = isMobile ? 10 : 11;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 24;

// Simple event-based store so all terminals react to changes
const listeners = new Set<() => void>();
let currentThemeId = localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME_ID;
let currentFontId = localStorage.getItem(FONT_STORAGE_KEY) || DEFAULT_FONT_ID;
let currentWeight = parseInt(localStorage.getItem(WEIGHT_STORAGE_KEY) || String(DEFAULT_WEIGHT), 10);
let currentFontSize = parseInt(localStorage.getItem(FONTSIZE_STORAGE_KEY) || String(DEFAULT_FONT_SIZE), 10);

function notify() {
  listeners.forEach((cb) => cb());
}

function getSnapshot() {
  return `${currentThemeId}|${currentFontId}|${currentWeight}|${currentFontSize}`;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function setThemeId(id: string) {
  currentThemeId = id;
  localStorage.setItem(STORAGE_KEY, id);
  notify();
  notifyAppTheme();
}

function setFontId(id: string) {
  currentFontId = id;
  localStorage.setItem(FONT_STORAGE_KEY, id);
  // Reset weight if not available in new font
  const font = FONTS.find((f) => f.id === id) || FONTS[0];
  if (!font.weights.includes(currentWeight)) {
    currentWeight = font.weights[0];
    localStorage.setItem(WEIGHT_STORAGE_KEY, String(currentWeight));
  }
  notify();
}

function setWeight(w: number) {
  currentWeight = w;
  localStorage.setItem(WEIGHT_STORAGE_KEY, String(w));
  notify();
}

function setFontSize(size: number) {
  currentFontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, size));
  localStorage.setItem(FONTSIZE_STORAGE_KEY, String(currentFontSize));
  notify();
}

export function getTerminalTheme(id?: string): TerminalThemeEntry {
  const target = id || currentThemeId;
  return allThemes.find((t) => t.id === target) || allThemes[0];
}

export function getTerminalFont(id?: string): TerminalFont {
  const target = id || currentFontId;
  return FONTS.find((f) => f.id === target) || FONTS[0];
}

export function useTerminalTheme() {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const activeTheme = getTerminalTheme(currentThemeId);
  const activeFont = getTerminalFont(currentFontId);
  const activeWeight = currentWeight;
  const activeFontSize = currentFontSize;

  return {
    themes: allThemes,
    darkThemes: allThemes.filter((t) => t.type === 'dark'),
    lightThemes: allThemes.filter((t) => t.type === 'light'),
    activeTheme,
    setTheme: useCallback((id: string) => setThemeId(id), []),
    fonts: FONTS,
    activeFont,
    activeWeight,
    activeFontSize,
    setFont: useCallback((id: string) => setFontId(id), []),
    setWeight: useCallback((w: number) => setWeight(w), []),
    setFontSize: useCallback((s: number) => setFontSize(s), []),
  };
}
