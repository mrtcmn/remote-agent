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

/**
 * Mount the app into `root`. Extracted verbatim from the previous main.tsx body
 * so the desktop shell (packages/desktop) can install its window.electronAPI shim
 * BEFORE this runs, then mount the same UI with zero behavioral change. The web
 * entry (main.tsx) calls mountApp(document.getElementById('root')!).
 *
 * NOTE: must NOT import electrobun/* here — the UI stays framework-agnostic and
 * detects the desktop shell solely via window.electronAPI?.isElectron.
 */
export function mountApp(root: HTMLElement) {
  // Add electron-app class to html element if in Electron (desktop shell)
  if (isElectron()) {
    document.documentElement.classList.add('electron-app');
  }

  // Initialize API config (loads saved URL) before rendering
  useApiConfig.getState().initialize().then(() => {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </React.StrictMode>
    );
  });
}
