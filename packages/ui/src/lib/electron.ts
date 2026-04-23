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

export function isElectron(): boolean {
  return !!(window as any).electronAPI?.isElectron;
}
