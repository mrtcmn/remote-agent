import { dlopen, FFIType, type Pointer } from "bun:ffi";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "electrobun/bun";
import type { BrowserWindow } from "electrobun/bun";

// NSVisualEffectMaterial. 21 = UnderWindowBackground (Electron's 'under-window').
// ponytail: visual knob — 7 (Sidebar) is lighter, 12 (WindowBackground) is denser.
const MATERIAL = 21;

// native/glass.m, compiled by `build:glass` and copied into the bundle.
const LIB = join(PATHS.RESOURCES_FOLDER, "app", "native", "libglass.dylib");

let lib: { symbols: { ra_set_glass: (win: Pointer, enabled: number, material: number) => void } } | null = null;

function load() {
  if (lib || process.platform !== "darwin") return lib;
  if (!existsSync(LIB)) {
    console.warn("[glass] libglass.dylib not found — run build:glass");
    return null;
  }
  lib = dlopen(LIB, {
    ra_set_glass: { args: [FFIType.ptr, FFIType.i32, FFIType.i32], returns: FFIType.void },
  });
  return lib;
}

/**
 * macOS window vibrancy, like Electron's BrowserWindow `vibrancy`. The native side
 * blurs the desktop behind the window; `html.glass` tells the page to make its
 * frame translucent so the blur shows through (index.css).
 */
export function applyGlass(win: BrowserWindow, enabled: boolean) {
  const ptr = win.ptr;
  const native = load();
  if (ptr && native) native.symbols.ra_set_glass(ptr, enabled ? 1 : 0, MATERIAL);
  console.log(`[glass] enabled=${enabled} window=${ptr ? "ok" : "null"} lib=${native ? "ok" : "missing"}`);
  win.webview?.executeJavascript(`document.documentElement.classList.toggle('glass', ${enabled})`);
}

/** Applies now and again on every page load (a reload drops the html class). */
export function installGlass(win: BrowserWindow, isEnabled: () => boolean) {
  applyGlass(win, isEnabled());
  win.webview?.on("dom-ready", () => applyGlass(win, isEnabled()));
}
