import type { RPCSchema } from "electrobun";

// Mirrors the existing window.electronAPI contract (packages/electron/src/preload.ts)
// so packages/ui needs no behavioral change. getMode/setMode are exposed on the bun
// side for completeness; the renderer shim only surfaces the 4 methods the UI uses
// plus isElectron (see src/mainview/bridge.ts).
export type DesktopRPC = {
  bun: RPCSchema<{
    requests: {
      getApiUrl: { params: Record<string, never>; response: string };
      setApiUrl: { params: { url: string }; response: void };
      getMode: { params: Record<string, never>; response: "local" | "remote" };
      setMode: { params: { mode: "local" | "remote" }; response: void };
      checkConnection: {
        params: { url: string };
        // NOTE: the API /health route returns { status: "ok", timestamp } only —
        // it does NOT return `mode`. We keep `mode` optional for behavioral parity
        // with the current Electron checkConnection (where it is likewise undefined).
        response: { ok: boolean; mode?: string; error?: string };
      };
      selectFolder: {
        params: { title?: string; defaultPath?: string };
        response: { canceled: boolean; path: string | null };
      };
    };
    messages: Record<string, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: Record<string, never>;
  }>;
};
