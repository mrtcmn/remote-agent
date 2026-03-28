# Light Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global light mode to the Remote Agent UI with 4 theme options: Dark, Light, System, Terminal (follows terminal theme).

**Architecture:** Create a `useAppTheme` hook that manages a global UI theme preference (dark/light/system/terminal) persisted in localStorage. The hook applies/removes a `light` CSS class on `<html>`. CSS variables in `index.css` get a `.light` variant. The theme picker is added to the existing ThemeSelector panel. Hardcoded dark-only colors across ~15 files are updated to be theme-aware.

**Tech Stack:** React, TailwindCSS (class-based dark mode), CSS custom properties, localStorage, useSyncExternalStore.

**Dev Setup:** Run the Vite frontend dev server on port **5174** (not default 5173 or API's 5100) to avoid conflicts with the production system. The proxy to `localhost:5100` reaches the already-running production API. Test credentials: `test@t.com` / `123456`.

---

### Task 1: Dev Server Port Configuration

**Files:**
- Modify: `packages/ui/vite.config.ts`

- [ ] **Step 1: Change Vite dev port to 5174**

In `packages/ui/vite.config.ts`, change the server port:

```typescript
server: {
  port: 5174,
```

- [ ] **Step 2: Start the dev server and verify it works**

Run: `cd packages/ui && npx vite --port 5174`
Expected: Vite dev server starts on http://localhost:5174, proxies API calls to localhost:5100.

- [ ] **Step 3: Verify login works with test credentials**

Use agent-browser to navigate to http://localhost:5174/login, enter `test@t.com` / `123456`, confirm login succeeds and dashboard loads.

- [ ] **Step 4: Revert port change (keep default)**

Actually, we do NOT need to change vite.config.ts permanently. Just run the dev server with `--port 5174` flag. Revert if changed.

---

### Task 2: Light Mode CSS Variables

**Files:**
- Modify: `packages/ui/src/index.css`

- [ ] **Step 1: Add `.light` CSS variable overrides in index.css**

Add this block after the existing `:root` block inside `@layer base`:

```css
.light {
  --background: 0 0% 100%;
  --foreground: 0 0% 9%;
  --card: 0 0% 98%;
  --card-foreground: 0 0% 9%;
  --primary: 142 76% 36%;
  --primary-foreground: 0 0% 98%;
  --secondary: 0 0% 93%;
  --secondary-foreground: 0 0% 9%;
  --muted: 0 0% 93%;
  --muted-foreground: 0 0% 40%;
  --accent: 0 0% 93%;
  --accent-foreground: 0 0% 9%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 0 0% 98%;
  --border: 0 0% 85%;
  --input: 0 0% 85%;
  --ring: 142 76% 36%;
  --popover: 0 0% 100%;
  --popover-foreground: 0 0% 9%;
  --sidebar: 0 0% 96%;
  --sidebar-foreground: 0 0% 15%;
  --sidebar-border: 0 0% 88%;
  --sidebar-accent: 0 0% 93%;
}
```

- [ ] **Step 2: Update scrollbar styles for light mode**

After the existing scrollbar styles, add light-mode-aware overrides:

```css
.light ::-webkit-scrollbar-track {
  background: hsl(var(--background));
}

.light ::-webkit-scrollbar-thumb {
  background: hsl(0 0% 75%);
}

.light ::-webkit-scrollbar-thumb:hover {
  background: hsl(0 0% 55%);
}
```

- [ ] **Step 3: Update xterm scrollbar for light mode**

Update the existing `.xterm-light-theme` scrollbar CSS — it's already correct. No changes needed there.

- [ ] **Step 4: Add light-mode diff view colors**

```css
.light .diff-view-container {
  --diff-add-bg: rgba(46, 160, 67, 0.12);
  --diff-remove-bg: rgba(248, 81, 73, 0.12);
  --diff-add-color: #1a7f37;
  --diff-remove-color: #cf222e;
}
```

- [ ] **Step 5: Update terminal container gradient for light mode**

```css
.light .terminal-container {
  background: linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--background)) 100%);
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/index.css
git commit -m "feat: add light mode CSS variables and overrides"
```

---

### Task 3: Create `useAppTheme` Hook

**Files:**
- Create: `packages/ui/src/hooks/useAppTheme.ts`

- [ ] **Step 1: Create the hook file**

```typescript
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

// Listen for terminal theme changes (localStorage)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'terminal-theme-id' && currentMode === 'terminal') {
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

  // Re-apply on mount and mode change
  useEffect(() => {
    applyTheme();
  }, [mode]);

  return {
    mode,
    setMode: useCallback((m: AppThemeMode) => setMode(m), []),
    resolved: getResolvedTheme(),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/hooks/useAppTheme.ts
git commit -m "feat: add useAppTheme hook with dark/light/system/terminal modes"
```

---

### Task 4: Wire `notifyAppTheme` into Terminal Theme Changes

**Files:**
- Modify: `packages/ui/src/hooks/useTerminalTheme.ts`

- [ ] **Step 1: Import notifyAppTheme in useTerminalTheme.ts**

At the top of the file, add:

```typescript
import { notifyAppTheme } from '@/hooks/useAppTheme';
```

- [ ] **Step 2: Call notifyAppTheme when terminal theme changes**

In the `setThemeId` function, after `notify()`, add:

```typescript
function setThemeId(id: string) {
  currentThemeId = id;
  localStorage.setItem(STORAGE_KEY, id);
  notify();
  notifyAppTheme();
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/hooks/useTerminalTheme.ts
git commit -m "feat: notify app theme when terminal theme changes"
```

---

### Task 5: Add UI Theme Picker to ThemeSelector

**Files:**
- Modify: `packages/ui/src/components/ThemeSelector.tsx`

- [ ] **Step 1: Add app theme section to ThemeSelector**

Import the hook and icons at the top:

```typescript
import { useAppTheme, type AppThemeMode } from '@/hooks/useAppTheme';
import { Monitor, Palette } from 'lucide-react';
```

Add `Monitor` and `Palette` to the existing lucide-react import (merge with `Check, Sun, Moon, Type`).

- [ ] **Step 2: Add the UI theme controls inside the scrollable content**

After the font weight section and before the `<div className="h-px bg-border mx-1 mb-1" />` divider, add a new "UI Theme" section:

```tsx
<div className="h-px bg-border mx-1 mb-1" />

{/* UI Theme section */}
<div className="flex items-center gap-1.5 px-2 pt-1.5 pb-1">
  <Palette className="size-3 text-muted-foreground" />
  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">UI Theme</span>
</div>

<div className="grid grid-cols-2 gap-1 px-2 pb-2">
  {([
    { id: 'dark' as AppThemeMode, label: 'Dark', icon: Moon },
    { id: 'light' as AppThemeMode, label: 'Light', icon: Sun },
    { id: 'system' as AppThemeMode, label: 'System', icon: Monitor },
    { id: 'terminal' as AppThemeMode, label: 'Terminal', icon: Palette },
  ]).map((opt) => (
    <button
      key={opt.id}
      onClick={() => setAppMode(opt.id)}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[10px] font-medium transition-colors',
        appMode === opt.id
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
      )}
    >
      <opt.icon className="size-3" />
      {opt.label}
    </button>
  ))}
</div>
```

- [ ] **Step 3: Use the hook inside ThemeSelector component**

Inside the `ThemeSelector` function, add:

```typescript
const { mode: appMode, setMode: setAppMode } = useAppTheme();
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/ThemeSelector.tsx
git commit -m "feat: add UI theme picker with dark/light/system/terminal options"
```

---

### Task 6: Fix Hardcoded Overlay Colors

**Files:**
- Modify: `packages/ui/src/components/Layout.tsx`
- Modify: `packages/ui/src/components/Terminal.tsx`
- Modify: `packages/ui/src/pages/Session.tsx`
- Modify: `packages/ui/src/components/NewSessionModal.tsx`
- Modify: `packages/ui/src/components/ConfirmDeleteDialog.tsx`
- Modify: `packages/ui/src/components/CreateRunConfigModal.tsx`
- Modify: `packages/ui/src/components/UploadModal.tsx`
- Modify: `packages/ui/src/components/MoveOrCopyModal.tsx`
- Modify: `packages/ui/src/components/kanban/TaskDetailPanel.tsx`
- Modify: `packages/ui/src/components/kanban/CreateTaskModal.tsx`
- Modify: `packages/ui/src/pages/McpServers.tsx`

- [ ] **Step 1: Replace `bg-black/50` with `bg-black/50 light:bg-black/30` in all overlay backdrops**

Actually, `bg-black/50` works fine for both modes as modal overlays — it's a standard pattern. The backdrop darkens in both themes. **No change needed for overlays.**

- [ ] **Step 2: Fix `text-white` on notification badges**

In `Layout.tsx` line 87, `NotificationInbox.tsx` line 51, `NotificationPanel.tsx` line 345, and `Session.tsx` line 64 — these badges use `bg-red-500 text-white` or `bg-orange-500 text-white`. White text on colored badges is correct in both modes. **No change needed.**

- [ ] **Step 3: Fix Terminal.tsx status indicator**

In `Terminal.tsx` line 79, change:
```
bg-black/50
```
to:
```
bg-black/50 dark:bg-black/50 light:bg-white/70
```

Wait — Tailwind with `darkMode: 'class'` uses `dark:` prefix. Since our default CSS vars are dark, and we add `light` class, we should use custom approach. Actually the simplest: replace `bg-black/50` with `bg-background/80` so it uses the CSS variable.

In `Terminal.tsx` line 79:
- Change `bg-black/50` → `bg-background/80`

In `Terminal.tsx` line 89:
- Change `text-white/70` → `text-foreground/70`

- [ ] **Step 4: Fix ThemeSelector border**

In `ThemeSelector.tsx` line 19:
- Change `border-white/10` → `border-foreground/10`

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/Terminal.tsx packages/ui/src/components/ThemeSelector.tsx
git commit -m "fix: replace hardcoded dark-only colors with theme-aware tokens"
```

---

### Task 7: Initialize Theme on App Mount

**Files:**
- Modify: `packages/ui/src/App.tsx`

- [ ] **Step 1: Import and call useAppTheme in App.tsx**

Add to App.tsx imports:

```typescript
import { useAppTheme } from './hooks/useAppTheme';
```

Inside the `App` component function body (before the return), add:

```typescript
useAppTheme();
```

This ensures the theme class is applied on the root `<html>` element when the app loads.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/App.tsx
git commit -m "feat: initialize app theme on mount"
```

---

### Task 8: Visual Testing - Login Page

**Files:** None (testing only)

- [ ] **Step 1: Start dev server on port 5174**

```bash
cd packages/ui && npx vite --port 5174 &
```

- [ ] **Step 2: Test dark mode login page**

Use agent-browser to navigate to `http://localhost:5174/login`. Take a screenshot. Verify the login page renders correctly in dark mode.

- [ ] **Step 3: Switch to light mode via browser console**

In agent-browser, execute JS: `document.documentElement.classList.add('light'); document.documentElement.classList.remove('dark');`
Take a screenshot. Verify:
- Background is white/light
- Text is dark and readable
- Card, input fields, buttons all have appropriate contrast
- Logo is visible

- [ ] **Step 4: Login with test credentials**

Enter `test@t.com` / `123456` and submit. Verify login succeeds.

---

### Task 9: Visual Testing - Dashboard

- [ ] **Step 1: Test dashboard in light mode**

Navigate to `http://localhost:5174/`. Set light mode via console. Take screenshot. Verify:
- Sidebar has light background
- Session list is readable
- Status dots are visible on light background
- Navigation items have proper contrast

- [ ] **Step 2: Test dashboard in dark mode**

Remove light class, add dark class. Verify nothing is broken from original dark theme.

---

### Task 10: Visual Testing - Session Page

- [ ] **Step 1: Open a session in light mode**

Navigate to a session. Apply light mode. Take screenshot. Verify:
- Terminal area renders correctly
- File explorer is readable
- Tab bar has proper contrast
- Status indicators visible

- [ ] **Step 2: Open ThemeSelector and verify UI theme picker**

Click the theme button in the terminal area. Verify:
- 4 UI theme buttons are visible (Dark, Light, System, Terminal)
- Clicking "Light" switches the entire UI to light mode
- Clicking "Dark" switches back
- Terminal themes still work independently

---

### Task 11: Visual Testing - Remaining Pages

- [ ] **Step 1: Test Settings page in light mode**

Navigate to `/settings`. Apply light mode. Screenshot. Verify readability.

- [ ] **Step 2: Test Kanban page in light mode**

Navigate to `/kanban`. Apply light mode. Screenshot. Verify:
- Column backgrounds have subtle tints
- Cards are readable
- Priority/status badges have contrast
- The existing `dark:` prefixed classes work (they should since Kanban already has light/dark pairs)

- [ ] **Step 3: Test Skills page in light mode**

Navigate to `/skills`. Screenshot. Verify readability.

- [ ] **Step 4: Test MCP Servers page in light mode**

Navigate to `/mcp-servers`. Screenshot. Verify readability.

- [ ] **Step 5: Test Projects page in light mode**

Navigate to `/projects`. Screenshot. Verify readability.

---

### Task 12: Fix Issues Found During Testing

- [ ] **Step 1: Fix any contrast or readability issues found in Tasks 8-11**

Review all screenshots. For each issue:
- Identify the component and line
- Replace hardcoded color with theme-aware alternative
- Re-test visually

- [ ] **Step 2: Commit fixes**

```bash
git add -A
git commit -m "fix: resolve light mode visual issues found during testing"
```

---

### Task 13: Final Verification and Cleanup

- [ ] **Step 1: Full walkthrough in dark mode**

Verify dark mode still looks exactly as before (no regressions).

- [ ] **Step 2: Full walkthrough in light mode**

Verify all pages look correct in light mode.

- [ ] **Step 3: Test system preference mode**

Set app to "System" mode. Verify it follows OS preference.

- [ ] **Step 4: Test terminal preference mode**

Set app to "Terminal" mode. Switch terminal theme from a dark theme to a light theme. Verify the entire UI switches to light mode.

- [ ] **Step 5: Run TypeScript check**

```bash
cd packages/ui && npx tsc --noEmit
```

- [ ] **Step 6: Run build**

```bash
cd packages/ui && npm run build
```

- [ ] **Step 7: Final commit if needed**

```bash
git add -A
git commit -m "feat: complete light mode implementation"
```
