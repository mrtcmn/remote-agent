import { BrowserView, Utils } from "electrobun/bun";
import { homedir } from "node:os";
import type { Store } from "./store";
import type { DesktopRPC } from "../shared/rpc";

/**
 * RPC handlers backing window.electronAPI. Mirrors the ipcMain.handle handlers
 * in packages/electron/src/main.ts.
 */
export function createRpc(store: Store) {
  return BrowserView.defineRPC<DesktopRPC>({
    maxRequestTime: 15000,
    handlers: {
      requests: {
        getApiUrl: () => store.get("apiUrl"),
        setApiUrl: ({ url }) => {
          store.set("apiUrl", url);
        },
        getMode: () => store.get("mode"),
        setMode: ({ mode }) => {
          store.set("mode", mode);
        },
        checkConnection: async ({ url }) => {
          try {
            const res = await fetch(`${url.replace(/\/$/, "")}/health`);
            if (res.ok) {
              const data = (await res.json()) as Record<string, unknown>;
              // /health returns { status, timestamp }; `mode` is undefined (parity).
              if (data.status === "ok") return { ok: true, mode: data.mode as string };
            }
            return { ok: false, error: `Server responded ${res.status}` };
          } catch (err: any) {
            return { ok: false, error: err?.message || "Connection failed" };
          }
        },
        selectFolder: async ({ defaultPath }) => {
          const paths = await Utils.openFileDialog({
            startingFolder: defaultPath || `${homedir()}/`,
            canChooseFiles: false,
            canChooseDirectory: true,
            allowsMultipleSelection: false,
          });
          // CANCEL GOTCHA: openFileDialog returns [""] (not []) on cancel.
          if (!paths.length || paths[0] === "") return { canceled: true, path: null };
          return { canceled: false, path: paths[0] };
        },
      },
      messages: {},
    },
  });
}
