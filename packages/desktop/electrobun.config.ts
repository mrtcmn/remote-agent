import type { ElectrobunConfig } from "electrobun";

// The browser panel is a CEF webview; agent-browser drives it over CDP here.
// Must equal the API's CDP_PORT (API port + 10): dev API 13690, the app 13590.
const CDP_PORT = process.env.ELECTROBUN_BUILD_ENV === "dev" ? "13700" : "13600";

export default {
  app: {
    name: "Remote Agent",
    identifier: "com.remote-agent.app",
    version: "1.3.0",
    // Deep linking: remoteagent://open/sessions/<id> focuses the app + routes.
    // macOS only, and registration requires the app to live in /Applications.
    urlSchemes: ["remoteagent"],
  },
  build: {
    bun: {
      // Main process entrypoint (the Bun side).
      entrypoint: "src/bun/index.ts",
    },
    views: {
      // The renderer view. In production this is served from views://mainview/.
      mainview: { entrypoint: "src/mainview/index.tsx" },
    },
    copy: {
      // Vite-built UI -> bundled view assets (views://mainview/...).
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
      // The API server bundle + its file-import assets (runnable by the vendored Bun).
      // Copy the whole outdir so asset paths baked by bun build resolve correctly.
      "dist-server": "server",
      // Drizzle migration files the server needs at runtime.
      "../api/drizzle": "server/drizzle",
      "../api/drizzle-sqlite": "server/drizzle-sqlite",
      // The notch companion (built by `build:notch`) so the app ships as one thing.
      "../notch/.build/release/RemoteAgentNotch": "notch/RemoteAgentNotch",
      // Window vibrancy helper (built by `build:glass`), loaded with bun:ffi.
      "native/build/libglass.dylib": "native/libglass.dylib",
      // Tray icon.
      "assets/trayTemplate.png": "views/assets/trayTemplate.png",
      "assets/trayTemplate@2x.png": "views/assets/trayTemplate@2x.png",
    },
    mac: {
      // CEF only for the browser panel; the app's own window stays native.
      bundleCEF: true,
      defaultRenderer: "native",
      // Electrobun's own toggleDevTools still looks for 9222-9232, so the UI's
      // Inspector button opens the frontend on this port itself.
      chromiumFlags: { "remote-debugging-port": CDP_PORT },
      // WKWebView hides navigator.mediaDevices entirely unless the host app
      // declares a microphone usage string; electrobun derives the Info.plist
      // key (NSMicrophoneUsageDescription) from this entitlement.
      entitlements: {
        "com.apple.security.device.audio-input":
          "Remote Agent uses your microphone for dictation.",
      },
      icons: "icon.iconset",
      // codesign: true, notarize: true,  // enable in Task 20
    },
    win: { bundleCEF: false, defaultRenderer: "native" },
    // Linux: GTK/WebKitGTK can't do Electrobun's webview layering — bundle CEF.
    linux: { bundleCEF: true, defaultRenderer: "cef" },
  },
  scripts: {
    postBuild: "scripts/hide-cef-helpers.ts",
  },
  runtime: {
    // Tray keeps the app alive after the window closes (current macOS behavior).
    exitOnLastWindowClosed: false,
  },
  // release: { baseUrl: "https://updates.example.com/remote-agent" }, // Task 20
} satisfies ElectrobunConfig;
