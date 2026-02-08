/**
 * Theme matching the web UI's dark theme with HSL color palette.
 * Mirrors packages/ui tailwind.config.ts and index.css.
 */

export const colors = {
  // Core backgrounds
  background: '#0a0a0a', // hsl(0, 0%, 4%)
  foreground: '#fafafa', // hsl(0, 0%, 98%)

  // Card / elevated surfaces
  card: '#0a0a0a',
  cardForeground: '#fafafa',

  // Popover / dropdown
  popover: '#0a0a0a',
  popoverForeground: '#fafafa',

  // Primary (green)
  primary: '#22c55e', // hsl(142, 76%, 36%)
  primaryForeground: '#052e16', // hsl(144, 80%, 10%)

  // Secondary
  secondary: '#262626', // hsl(0, 0%, 15%)
  secondaryForeground: '#fafafa',

  // Muted
  muted: '#262626', // hsl(0, 0%, 15%)
  mutedForeground: '#a3a3a3', // hsl(0, 0%, 64%)

  // Accent
  accent: '#262626',
  accentForeground: '#fafafa',

  // Destructive (red)
  destructive: '#b91c1c', // hsl(0, 72%, 42%)
  destructiveForeground: '#fafafa',

  // Border / ring
  border: '#262626', // hsl(0, 0%, 15%)
  input: '#262626',
  ring: '#22c55e', // same as primary

  // Status colors (from Dashboard)
  statusActive: '#22c55e', // green
  statusWaiting: '#eab308', // yellow
  statusPaused: '#9ca3af', // gray
  statusTerminated: '#ef4444', // red

  // Notification specific
  indigo: '#6366f1',

  // Utility
  transparent: 'transparent',
  white: '#ffffff',
  black: '#000000',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 48,
} as const;

export const borderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
} as const;

export const fontWeight = {
  normal: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
} as const;
