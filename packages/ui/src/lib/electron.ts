interface ElectronAPI {
  getApiUrl: () => Promise<string>;
  setApiUrl: (url: string) => Promise<void>;
  checkConnection: (url: string) => Promise<{ ok: boolean; error?: string }>;
  selectFolder: (opts?: { title?: string; defaultPath?: string }) => Promise<{ canceled: boolean; path: string | null }>;
  isElectron: true;
}

export function getElectronAPI(): ElectronAPI | null {
  const api = (window as any).electronAPI;
  if (api?.isElectron) return api as ElectronAPI;
  return null;
}

// Detect running inside the desktop shell (Electrobun or legacy Electron).
// Electrobun injects window.__electrobun via its preload on every BrowserWindow URL —
// this is reliable even in dev mode where the mainview shim (window.electronAPI) isn't loaded.
export function isElectron(): boolean {
  const isIt = !!(window as any).__electrobun || !!(window as any).electronAPI?.isElectron;
  console.log('[isElectron]:', isIt);

  return isIt;
}
