import { BrowserWindow, Utils } from "electrobun/bun";
import type { BrowserView } from "electrobun/bun";
import type { Store } from "./store";
import type { DesktopRPC } from "../shared/rpc";

const DEV = process.argv.includes("--dev") || process.env.ELECTROBUN_BUILD_ENV === "dev";
const REMOTE = process.argv.includes("--remote");

/** Mirrors the load-URL branching of packages/electron/src/main.ts. */
export function resolveLoadUrl(store: Store): string {
  if (DEV) return REMOTE ? "https://ra.grasco.dev" : "http://localhost:13591";
  const apiUrl = store.get("apiUrl");
  if (store.get("mode") === "local") return apiUrl || "http://localhost:13590";
  return apiUrl || "views://mainview/index.html";
}

export function createWindow(
  store: Store,
  rpc: ReturnType<typeof BrowserView.defineRPC<DesktopRPC>>,
): BrowserWindow {
  const b = store.get("windowBounds");
  const win = new BrowserWindow({
    title: "Remote Agent",
    frame: { x: b.x ?? 0, y: b.y ?? 0, width: b.width, height: b.height },
    // macOS inset traffic lights; behaves like "hidden" on Win/Linux.
    titleBarStyle: "hiddenInset",
    url: resolveLoadUrl(store),
    rpc,
  });
  // R1: Electron's minWidth/minHeight has no Electrobun equivalent (accepted).
  // R2: backgroundColor isn't a window option; dark bg is set in the view CSS.
  return win;
}

/** Task 10: route external links to the default browser. */
export function installExternalLinkHandlers(win: BrowserWindow, allowedOrigin: string) {
  // Popups / target=_blank -> default browser. Event name is not in the TS union.
  win.webview.on("new-window-open" as any, (e: any) => {
    const url = typeof e.detail === "object" ? e.detail.url : e.detail;
    if (url) Utils.openExternal(url);
  });

  // Block cross-origin top-level navigation declaratively; allow same-origin + views.
  win.webview.setNavigationRules([
    `${allowedOrigin}/*`,
    "views://*",
    "^http://*",
    "^https://*",
  ]);

  // Observe blocked navigations and open them externally instead.
  win.webview.on("will-navigate", (e: any) => {
    try {
      if (!e.data.allowed && /^https?:/.test(e.data.url)) Utils.openExternal(e.data.url);
    } catch {}
  });
}

/** Task 11: persist window bounds on resize/move. */
export function persistBounds(win: BrowserWindow, store: Store) {
  const save = (e: any) => {
    const { x, y, width, height } = e.data;
    const prev = store.get("windowBounds");
    store.set("windowBounds", {
      x,
      y,
      width: width ?? prev.width,
      height: height ?? prev.height,
    });
  };
  win.on("resize", save);
  win.on("move", save);
}
