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
  if (store.get("mode") === "local") {
    try {
      const apiUrl = await startLocalApi();
      store.set("apiUrl", apiUrl);
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

// Kill the API child on quit (Electrobun does not track grandchildren).
Electrobun.events.on("before-quit", () => stopLocalApi());
process.on("exit", () => stopLocalApi());
