import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getApiUrl: (): Promise<string> => ipcRenderer.invoke('get-api-url'),
  setApiUrl: (url: string): Promise<void> => ipcRenderer.invoke('set-api-url', url),
  checkConnection: (url: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('check-connection', url),
  isElectron: true,
});
