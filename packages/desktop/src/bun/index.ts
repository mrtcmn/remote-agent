import Electrobun, { ApplicationMenu, Utils } from "electrobun/bun";
import { createStore } from "./store";
import { createRpc } from "./rpc";
import {
  createWindow,
  installExternalLinkHandlers,
  persistBounds,
  resolveLoadUrl,
} from "./window";
import { createTray } from "./tray";
import { startLocalApi, stopLocalApi } from "./local-api";
import { startNotch, stopNotch } from "./notch";

// Dev: `desktop:dev` sets this. The webview loads Vite (13591), which proxies
// /api + /ws to the `bun run dev` API on 13590 — so we skip the embedded server.
const DEV = process.argv.includes("--dev") || process.env.ELECTROBUN_BUILD_ENV === "dev";

const store = createStore(Utils.paths.userData);
const rpc = createRpc(store);
let win: ReturnType<typeof createWindow> | null = null;

function openWindow() {
  if (win) {
    win.show();
    win.activate();
    return;
  }
  win = createWindow(store, rpc);
  try {
    installExternalLinkHandlers(win, new URL(resolveLoadUrl(store)).origin);
  } catch {
    // views:// has no parseable origin; skip external-link interception.
  }
  persistBounds(win, store);
  win.on("close", () => {
    win = null;
  });
}

// macOS application menu — required for Cmd+C/V/X/A to work in WKWebView.
// Electrobun does not create a default menu unlike Electron.
ApplicationMenu.setApplicationMenu([
  {
    label: "Remote Agent",
    submenu: [
      { role: "hide" },
      { role: "hideOthers" },
      { role: "showAll" },
      { type: "divider" },
      { role: "quit" },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "divider" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "pasteAndMatchStyle" },
      { role: "delete" },
      { role: "selectAll" },
    ],
  },
]);

// Boot: start local API if in local mode, then create tray + window.
// (Electrobun runs top-level code at boot — there is no app.whenReady.)
(async () => {
  if (DEV) {
    // Use the running `bun run dev` API via the Vite proxy. Setting apiUrl to the
    // webview origin makes the UI issue same-origin (relative) requests → proxy → 13590.
    store.set("apiUrl", "http://localhost:13591");
    // Notch talks to the API directly (websockets don't need the Vite proxy).
    startNotch("http://localhost:13590");
  } else if (store.get("mode") === "local") {
    try {
      const apiUrl = await startLocalApi();
      store.set("apiUrl", apiUrl);
      // Packaged build: tell the notch to deep-link into this app (dev can't
      // register the scheme, so its notch keeps opening the browser).
      startNotch(apiUrl, "remoteagent");
    } catch (err: any) {
      console.error("Failed to start local API:", err?.message);
    }
  }
  createTray(
    openWindow,
    () => win?.webview?.executeJavascript("location.reload()"),
    () => win?.webview?.openDevTools(),
  );
  openWindow();
})();

// macOS dock-click / reopen (no app.on('activate') equivalent).
Electrobun.events.on("reopen", () => openWindow());

// Deep linking — remoteagent://open/sessions/<id> focuses the app and routes to it.
function deepLinkToPath(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "remoteagent:") return null;
    const path = u.pathname || "/";
    // Only known SPA routes — never navigate to an arbitrary/absolute target.
    if (!/^\/(sessions|projects|tasks|kanban|skills|settings)(\/|$)/.test(path)) return null;
    return path;
  } catch {
    return null;
  }
}

function navigateWebview(path: string) {
  // Wait in-page for the router to mount (__ra_ready), then client-route via
  // popstate — no reload, works whether the SPA is served from localhost or views://.
  const p = JSON.stringify(path);
  win?.webview?.executeJavascript(
    `(function go(){if(location.pathname===${p})return;` +
      `if(window.__ra_ready){history.pushState(null,'',${p});window.dispatchEvent(new PopStateEvent('popstate'));}` +
      `else{setTimeout(go,100);}})();`
  );
}

Electrobun.events.on("open-url", (e: any) => {
  const path = deepLinkToPath(e?.data?.url ?? "");
  if (!path) return;
  openWindow();               // create if needed, else show + activate + focus
  navigateWebview(path);      // in-page script self-retries until the SPA is ready
  setTimeout(() => navigateWebview(path), 800); // cold-start safety net (idempotent)
});

// Kill the API/notch children on quit (Electrobun does not track grandchildren).
Electrobun.events.on("before-quit", () => {
  stopLocalApi();
  stopNotch();
});
process.on("exit", () => {
  stopLocalApi();
  stopNotch();
});
