# Electron App with Acrylic Frosted Background — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the existing UI in an Electron shell with acrylic/frosted glass background, a first-run setup screen to configure the API URL, and persistent connection management.

**Architecture:** New `packages/electron` package. Electron main process creates a transparent/acrylic `BrowserWindow` and loads the built UI from `packages/ui/dist`. A preload script exposes IPC methods for reading/writing config (API URL) via `electron-store`. The UI's `api.ts` and WebSocket hooks are updated to use a configurable base URL (stored in a Zustand store) instead of hardcoded relative paths. A `SetupScreen` component gates the app on first run.

**Tech Stack:** Electron 33+, electron-store, electron-builder, TypeScript, existing React/Tailwind UI

---

## File Structure

### New files (packages/electron/)
- `packages/electron/package.json` — Electron package config, scripts, electron-builder config
- `packages/electron/tsconfig.json` — TypeScript config for main/preload
- `packages/electron/src/main.ts` — Electron main process: acrylic window, IPC handlers
- `packages/electron/src/preload.ts` — Context bridge: exposes config get/set to renderer
- `packages/electron/src/store.ts` — electron-store schema and helpers

### Modified files (packages/ui/)
- `packages/ui/src/lib/api.ts` — Make `API_BASE` dynamic, read from `apiBaseUrl` getter
- `packages/ui/src/lib/electron.ts` — NEW: detect Electron, expose typed preload API
- `packages/ui/src/lib/api-config.ts` — NEW: Zustand store for runtime API base URL
- `packages/ui/src/hooks/useWebSocket.ts` — Use dynamic host from api-config instead of `window.location.host`
- `packages/ui/src/hooks/useBrowserPreview.ts` — Same WebSocket host fix
- `packages/ui/src/components/SetupScreen.tsx` — NEW: first-run API URL setup UI
- `packages/ui/src/App.tsx` — Gate on SetupScreen when in Electron + no saved URL
- `packages/ui/src/main.tsx` — Initialize api-config from Electron store before render
- `packages/ui/src/index.css` — Add frosted glass utility classes

### Root
- `package.json` — Add electron dev/build scripts to workspace root

---

## Task 1: Create Electron Package Scaffold

**Files:**
- Create: `packages/electron/package.json`
- Create: `packages/electron/tsconfig.json`

- [ ] **Step 1: Create `packages/electron/package.json`**

```json
{
  "name": "@remote-agent/electron",
  "version": "1.0.0",
  "private": true,
  "main": "dist/main.js",
  "scripts": {
    "build:main": "tsc -p tsconfig.json",
    "start": "npm run build:main && electron dist/main.js",
    "dev": "npm run build:main && electron dist/main.js --dev",
    "dist": "npm run build:main && electron-builder"
  },
  "dependencies": {
    "electron-store": "^10.0.0"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "typescript": "^5.4.0"
  },
  "build": {
    "appId": "com.remote-agent.app",
    "productName": "Remote Agent",
    "files": [
      "dist/**/*",
      "node_modules/**/*"
    ],
    "extraResources": [
      {
        "from": "../ui/dist",
        "to": "ui",
        "filter": ["**/*"]
      }
    ],
    "mac": {
      "target": "dmg",
      "category": "public.app-category.developer-tools"
    },
    "win": {
      "target": "nsis"
    },
    "linux": {
      "target": "AppImage"
    }
  }
}
```

- [ ] **Step 2: Create `packages/electron/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Install dependencies**

```bash
cd packages/electron && npm install
```

- [ ] **Step 4: Commit**

```bash
git add packages/electron/package.json packages/electron/tsconfig.json
git commit -m "feat(electron): scaffold electron package with config"
```

---

## Task 2: Electron Store (Config Persistence)

**Files:**
- Create: `packages/electron/src/store.ts`

- [ ] **Step 1: Create `packages/electron/src/store.ts`**

```typescript
import Store from 'electron-store';

interface StoreSchema {
  apiUrl: string;
  windowBounds: {
    x?: number;
    y?: number;
    width: number;
    height: number;
  };
}

export const store = new Store<StoreSchema>({
  schema: {
    apiUrl: {
      type: 'string',
      default: '',
    },
    windowBounds: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number', default: 1200 },
        height: { type: 'number', default: 800 },
      },
      default: { width: 1200, height: 800 },
    },
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/electron/src/store.ts
git commit -m "feat(electron): add electron-store config persistence"
```

---

## Task 3: Preload Script (IPC Bridge)

**Files:**
- Create: `packages/electron/src/preload.ts`

- [ ] **Step 1: Create `packages/electron/src/preload.ts`**

```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getApiUrl: (): Promise<string> => ipcRenderer.invoke('get-api-url'),
  setApiUrl: (url: string): Promise<void> => ipcRenderer.invoke('set-api-url', url),
  checkConnection: (url: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('check-connection', url),
  isElectron: true,
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/electron/src/preload.ts
git commit -m "feat(electron): add preload script with IPC bridge"
```

---

## Task 4: Electron Main Process (Acrylic Window + IPC)

**Files:**
- Create: `packages/electron/src/main.ts`

- [ ] **Step 1: Create `packages/electron/src/main.ts`**

```typescript
import { app, BrowserWindow, ipcMain, net } from 'electron';
import path from 'path';
import { store } from './store';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const bounds = store.get('windowBounds');

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hiddenInset',
    transparent: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundMaterial: 'acrylic',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Save window bounds on resize/move
  const saveBounds = () => {
    if (mainWindow && !mainWindow.isMinimized()) {
      store.set('windowBounds', mainWindow.getBounds());
    }
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  // Load the UI
  const isDev = process.argv.includes('--dev');
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    const uiPath = path.join(process.resourcesPath, 'ui', 'index.html');
    mainWindow.loadFile(uiPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

ipcMain.handle('get-api-url', () => {
  return store.get('apiUrl');
});

ipcMain.handle('set-api-url', (_event, url: string) => {
  store.set('apiUrl', url);
});

ipcMain.handle('check-connection', async (_event, url: string) => {
  try {
    const response = await net.fetch(`${url.replace(/\/$/, '')}/health`, {
      method: 'GET',
    });
    if (response.ok) {
      const data = await response.json();
      if (data.status === 'ok') {
        return { ok: true };
      }
    }
    return { ok: false, error: `Server responded with status ${response.status}` };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Connection failed' };
  }
});

// ─── App Lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
```

- [ ] **Step 2: Build and verify it compiles**

```bash
cd packages/electron && npx tsc -p tsconfig.json --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add packages/electron/src/main.ts
git commit -m "feat(electron): add main process with acrylic window and IPC handlers"
```

---

## Task 5: UI — Electron Detection & API Config Store

**Files:**
- Create: `packages/ui/src/lib/electron.ts`
- Create: `packages/ui/src/lib/api-config.ts`

- [ ] **Step 1: Create `packages/ui/src/lib/electron.ts`**

```typescript
interface ElectronAPI {
  getApiUrl: () => Promise<string>;
  setApiUrl: (url: string) => Promise<void>;
  checkConnection: (url: string) => Promise<{ ok: boolean; error?: string }>;
  isElectron: true;
}

export function getElectronAPI(): ElectronAPI | null {
  const api = (window as any).electronAPI;
  if (api?.isElectron) return api as ElectronAPI;
  return null;
}

export function isElectron(): boolean {
  return !!(window as any).electronAPI?.isElectron;
}
```

- [ ] **Step 2: Create `packages/ui/src/lib/api-config.ts`**

```typescript
import { create } from 'zustand';
import { getElectronAPI, isElectron } from './electron';

interface ApiConfigState {
  apiBaseUrl: string;        // e.g. "https://my-server.com" or "" for relative
  wsBaseUrl: string;         // e.g. "wss://my-server.com" or "" for relative
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
  isConfigured: !isElectron(),  // Browser mode is always "configured" (uses relative URLs)
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

/** Get the current API base for fetch calls. Returns "" in browser mode (relative). */
export function getApiBase(): string {
  return useApiConfig.getState().apiBaseUrl;
}

/** Get the current WS base. Returns "" in browser mode (uses window.location). */
export function getWsBase(): string {
  return useApiConfig.getState().wsBaseUrl;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/electron.ts packages/ui/src/lib/api-config.ts
git commit -m "feat(ui): add electron detection and API config store"
```

---

## Task 6: UI — Update API Client to Use Dynamic Base URL

**Files:**
- Modify: `packages/ui/src/lib/api.ts:1` — change `API_BASE` to use `getApiBase()`

- [ ] **Step 1: Update `packages/ui/src/lib/api.ts`**

Replace the first line:

```typescript
const API_BASE = '/api';
```

With:

```typescript
import { getApiBase } from './api-config';

function getApiBaseUrl(): string {
  const base = getApiBase();
  return base ? `${base}/api` : '/api';
}
```

Then in the `request` function, replace:

```typescript
  const url = `${API_BASE}${endpoint}`;
```

With:

```typescript
  const url = `${getApiBaseUrl()}${endpoint}`;
```

- [ ] **Step 2: Verify the UI still compiles**

```bash
cd packages/ui && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/api.ts
git commit -m "feat(ui): make API base URL dynamic for electron support"
```

---

## Task 7: UI — Update WebSocket Hooks to Use Dynamic Host

**Files:**
- Modify: `packages/ui/src/hooks/useWebSocket.ts:42-43`
- Modify: `packages/ui/src/hooks/useBrowserPreview.ts:37-38`

- [ ] **Step 1: Update `useWebSocket.ts`**

Replace:

```typescript
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/session/${sessionId}`;
```

With:

```typescript
    import { getWsBase } from '../lib/api-config';
```

(Add the import at the top of the file)

And replace the URL construction with:

```typescript
    const wsBase = getWsBase();
    let wsUrl: string;
    if (wsBase) {
      wsUrl = `${wsBase}/ws/session/${sessionId}`;
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}/ws/session/${sessionId}`;
    }
```

- [ ] **Step 2: Update `useBrowserPreview.ts`**

Same pattern. Replace:

```typescript
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/preview/${previewId}`;
```

With (add import at top):

```typescript
    import { getWsBase } from '../lib/api-config';
```

```typescript
    const wsBase = getWsBase();
    let wsUrl: string;
    if (wsBase) {
      wsUrl = `${wsBase}/ws/preview/${previewId}`;
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}/ws/preview/${previewId}`;
    }
```

- [ ] **Step 3: Verify the UI still compiles**

```bash
cd packages/ui && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/hooks/useWebSocket.ts packages/ui/src/hooks/useBrowserPreview.ts
git commit -m "feat(ui): make WebSocket URLs dynamic for electron support"
```

---

## Task 8: UI — SetupScreen Component

**Files:**
- Create: `packages/ui/src/components/SetupScreen.tsx`

- [ ] **Step 1: Create `packages/ui/src/components/SetupScreen.tsx`**

```tsx
import { useState } from 'react';
import { getElectronAPI } from '../lib/electron';
import { useApiConfig } from '../lib/api-config';

export function SetupScreen() {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'error' | 'success'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const { setApiUrl } = useApiConfig();

  const handleConnect = async () => {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (!trimmed) {
      setErrorMessage('Please enter a URL');
      setStatus('error');
      return;
    }

    setStatus('checking');
    setErrorMessage('');

    const electronAPI = getElectronAPI();
    if (!electronAPI) return;

    const result = await electronAPI.checkConnection(trimmed);

    if (result.ok) {
      setStatus('success');
      await electronAPI.setApiUrl(trimmed);
      setApiUrl(trimmed);
    } else {
      setStatus('error');
      setErrorMessage(result.error || 'Could not connect to server');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && status !== 'checking') {
      handleConnect();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 app-drag">
      <div className="frosted-card w-full max-w-md p-8 rounded-2xl space-y-6 app-no-drag">
        {/* Logo / Title */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-2">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="text-primary">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Remote Agent</h1>
          <p className="text-sm text-muted-foreground">
            Connect to your Remote Agent server
          </p>
        </div>

        {/* URL Input */}
        <div className="space-y-2">
          <label htmlFor="api-url" className="text-sm font-medium text-foreground">
            Server URL
          </label>
          <input
            id="api-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="https://your-server.example.com"
            className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10
              text-foreground placeholder:text-muted-foreground
              focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50
              transition-all duration-200"
            disabled={status === 'checking'}
            autoFocus
          />
        </div>

        {/* Error Message */}
        {status === 'error' && errorMessage && (
          <div className="px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive">
            {errorMessage}
          </div>
        )}

        {/* Success Message */}
        {status === 'success' && (
          <div className="px-4 py-3 rounded-xl bg-primary/10 border border-primary/20 text-sm text-primary">
            Connected successfully! Loading...
          </div>
        )}

        {/* Connect Button */}
        <button
          onClick={handleConnect}
          disabled={status === 'checking' || status === 'success'}
          className="w-full py-3 px-4 rounded-xl font-medium transition-all duration-200
            bg-primary text-primary-foreground hover:bg-primary/90
            disabled:opacity-50 disabled:cursor-not-allowed
            flex items-center justify-center gap-2"
        >
          {status === 'checking' ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground" />
              Connecting...
            </>
          ) : status === 'success' ? (
            'Connected'
          ) : (
            'Connect'
          )}
        </button>

        <p className="text-xs text-center text-muted-foreground">
          Enter the URL where your Remote Agent API is running
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/SetupScreen.tsx
git commit -m "feat(ui): add SetupScreen component for electron first-run setup"
```

---

## Task 9: UI — Frosted Glass CSS Classes

**Files:**
- Modify: `packages/ui/src/index.css` — add frosted-card, app-drag, app-no-drag utilities

- [ ] **Step 1: Add frosted glass styles to `packages/ui/src/index.css`**

Add at the end of the file (after existing styles):

```css
/* Electron: frosted glass card */
.frosted-card {
  background: hsla(var(--card), 0.6);
  backdrop-filter: blur(40px) saturate(1.8);
  -webkit-backdrop-filter: blur(40px) saturate(1.8);
  border: 1px solid hsla(var(--border), 0.3);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 hsla(0, 0%, 100%, 0.05);
}

/* Electron: window drag regions */
.app-drag {
  -webkit-app-region: drag;
}
.app-no-drag {
  -webkit-app-region: no-drag;
}

/* Electron: transparent background for acrylic */
.electron-app body {
  background: transparent !important;
}
.electron-app .min-h-screen {
  background: transparent;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/index.css
git commit -m "feat(ui): add frosted glass and electron drag CSS utilities"
```

---

## Task 10: UI — Integrate SetupScreen into App + Initialize Config

**Files:**
- Modify: `packages/ui/src/main.tsx`
- Modify: `packages/ui/src/App.tsx`

- [ ] **Step 1: Update `packages/ui/src/main.tsx`**

Replace the entire file with:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { useApiConfig } from './lib/api-config';
import { isElectron } from './lib/electron';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
    },
  },
});

// Add electron-app class to html element if in Electron
if (isElectron()) {
  document.documentElement.classList.add('electron-app');
}

// Initialize API config (loads saved URL from electron-store) before rendering
useApiConfig.getState().initialize().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>
  );
});
```

- [ ] **Step 2: Update `packages/ui/src/App.tsx`**

Add imports at the top:

```typescript
import { isElectron } from './lib/electron';
import { useApiConfig } from './lib/api-config';
import { SetupScreen } from './components/SetupScreen';
```

Inside the `App` component, before the return statement, add:

```typescript
  const { isConfigured, isLoading: isConfigLoading } = useApiConfig();

  // Electron: show setup screen if API URL not configured
  if (isElectron() && isConfigLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (isElectron() && !isConfigured) {
    return <SetupScreen />;
  }
```

This goes right after `useAppTheme();` and before the `return (` with Routes.

- [ ] **Step 3: Verify compilation**

```bash
cd packages/ui && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/main.tsx packages/ui/src/App.tsx
git commit -m "feat(ui): integrate SetupScreen and API config initialization"
```

---

## Task 11: Root Package Scripts + Workspace Wire-up

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Add electron scripts to root `package.json`**

Add to the `"scripts"` section:

```json
    "electron:dev": "bun run build:ui && cd packages/electron && npm run dev",
    "electron:build": "bun run build:ui && cd packages/electron && npm run dist"
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "feat: add electron dev and build scripts to root package.json"
```

---

## Task 12: End-to-End Smoke Test

- [ ] **Step 1: Build the UI**

```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent && bun run build:ui
```

Expected: Vite build succeeds, `packages/ui/dist/` is populated.

- [ ] **Step 2: Build the Electron main process**

```bash
cd packages/electron && npx tsc -p tsconfig.json
```

Expected: Compiles to `packages/electron/dist/main.js`, `preload.js`, `store.js` without errors.

- [ ] **Step 3: Verify TypeScript across the whole project**

```bash
cd /app/workspaces/ht0ONt4cawOLyOxKAMfh3XlUOEMgLiDB/remote-agent && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A && git commit -m "fix: resolve any build issues from electron integration"
```

(Skip if no changes needed.)
