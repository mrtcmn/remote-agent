import { BrowserWindow, Screen, Utils } from "electrobun/bun";
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

type Bounds = { x?: number; y?: number; width: number; height: number };
type DisplayLike = { workArea: { x: number; y: number; width: number; height: number }; isPrimary?: boolean };

/** Keep at least this much of the window on a display so it stays grabbable. */
const MIN_VISIBLE = 48;

/**
 * Restore saved bounds onto a currently-connected display. Saved coordinates for a
 * secondary monitor are negative or past the primary display; once that monitor is
 * unplugged/rearranged the window would be created off-screen. If the saved rect no
 * longer overlaps any display's work area, recenter on the primary one.
 */
export function visibleFrame(b: Bounds, displays: DisplayLike[]): { x: number; y: number; width: number; height: number } {
  const { width, height, x, y } = b;
  const center = () => {
    const a = (displays.find((d) => d.isPrimary) ?? displays[0])?.workArea;
    if (!a) return { x: 0, y: 0, width, height }; // no displays reported yet
    return { x: Math.round(a.x + (a.width - width) / 2), y: Math.round(a.y + (a.height - height) / 2), width, height };
  };
  if (x == null || y == null) return center();

  const grabbable = displays.some((d) => {
    const a = d.workArea;
    const ox = Math.min(x + width, a.x + a.width) - Math.max(x, a.x);
    const oy = Math.min(y + height, a.y + a.height) - Math.max(y, a.y);
    return ox >= MIN_VISIBLE && oy >= MIN_VISIBLE;
  });
  return grabbable ? { x, y, width, height } : center();
}

export function createWindow(
  store: Store,
  rpc: ReturnType<typeof BrowserView.defineRPC<DesktopRPC>>,
): BrowserWindow {
  const frame = visibleFrame(store.get("windowBounds"), Screen.getAllDisplays());
  const win = new BrowserWindow({
    title: "Remote Agent",
    frame,
    // macOS inset traffic lights; behaves like "hidden" on Win/Linux.
    titleBarStyle: "hiddenInset",
    // Vertically center the macOS traffic lights in the app's top bar.
    // Measured from a screenshot: y=20 rendered the dots ~7pt high, so ~27 centers
    // them against the 36px h-9 bar (+8px canvas padding).
    // ponytail: visual knob — lower y raises the buttons; nudge if a hair off.
    trafficLightOffset: { x: 8, y: 27 },
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
