import { Electroview } from "electrobun/view";
import type { DesktopRPC } from "../shared/rpc";

/**
 * Recreate the exact window.electronAPI shape from
 * packages/electron/src/preload.ts over Electroview RPC. The UI consumes only
 * these 5 members (see packages/ui/src/lib/electron.ts), so this is a drop-in
 * replacement for the Electron contextBridge — the UI needs no change.
 *
 * MUST be called BEFORE the UI bundle evaluates (see index.tsx) so that
 * isElectron() reads true at module-eval time.
 */
export function installElectronApiShim() {
  const rpc = Electroview.defineRPC<DesktopRPC>({
    handlers: { requests: {}, messages: {} },
  });
  const ev = new Electroview({ rpc });

  (window as any).electronAPI = {
    getApiUrl: () => ev.rpc.request.getApiUrl({}),
    setApiUrl: (url: string) => ev.rpc.request.setApiUrl({ url }),
    checkConnection: (url: string) => ev.rpc.request.checkConnection({ url }),
    selectFolder: (opts?: { title?: string; defaultPath?: string }) =>
      ev.rpc.request.selectFolder(opts ?? {}),
    isElectron: true, // UI's detection key (lib/electron.ts) — keep it
  };
}
