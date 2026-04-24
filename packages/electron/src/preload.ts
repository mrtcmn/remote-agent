import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getApiUrl: (): Promise<string> => ipcRenderer.invoke('get-api-url'),
  setApiUrl: (url: string): Promise<void> => ipcRenderer.invoke('set-api-url', url),
  checkConnection: (url: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('check-connection', url),
  selectFolder: (opts?: { title?: string; defaultPath?: string }): Promise<{ canceled: boolean; path: string | null }> =>
    ipcRenderer.invoke('select-folder', opts),
  isElectron: true,
});
