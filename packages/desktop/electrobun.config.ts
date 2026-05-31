import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Remote Agent",
    identifier: "com.remote-agent.app",
    version: "1.0.0",
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
      // Tray icon.
      "assets/trayTemplate.png": "views/assets/trayTemplate.png",
      "assets/trayTemplate@2x.png": "views/assets/trayTemplate@2x.png",
    },
    mac: {
      bundleCEF: false,
      defaultRenderer: "native",
      // codesign: true, notarize: true,  // enable in Task 20
    },
    win: { bundleCEF: false, defaultRenderer: "native" },
    // Linux: GTK/WebKitGTK can't do Electrobun's webview layering — bundle CEF.
    linux: { bundleCEF: true, defaultRenderer: "cef" },
  },
  runtime: {
    // Tray keeps the app alive after the window closes (current macOS behavior).
    exitOnLastWindowClosed: false,
  },
  // release: { baseUrl: "https://updates.example.com/remote-agent" }, // Task 20
} satisfies ElectrobunConfig;
