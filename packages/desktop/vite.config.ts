import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Dev ports: 13690/13691, clear of the installed app on 13590. Override with
// RA_PORT and RA_UI_PORT.
const API_PORT = process.env.RA_PORT ?? "13690";
const UI_PORT = Number(process.env.RA_UI_PORT ?? 13691);

export default defineConfig({
  root: "src/mainview",
  plugins: [react()],
  resolve: {
    // Use an array so the more-specific @remote-agent/ui/src alias is checked
    // before the shorter @remote-agent/ui alias — order matters here.
    alias: [
      // @remote-agent/ui/src/index.css → ../ui/src/index.css
      { find: "@remote-agent/ui/src", replacement: path.resolve(__dirname, "../ui/src") },
      // @remote-agent/ui/mount → ../ui/src/mount (+ extension resolution)
      { find: "@remote-agent/ui", replacement: path.resolve(__dirname, "../ui/src") },
      // @/... → ../ui/src/... (UI-internal imports)
      { find: "@", replacement: path.resolve(__dirname, "../ui/src") },
    ],
  },
  // Serve the UI's static assets (logo.png, favicons, etc.) at the root.
  publicDir: path.resolve(__dirname, "../ui/public"),
  server: {
    port: UI_PORT,
    proxy: {
      "/api": {
        // 127.0.0.1 (not localhost): node can resolve localhost to ::1 and miss Bun's IPv4 bind.
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: false,
        cookieDomainRewrite: "localhost",
        secure: false,
      },
      "/ws": {
        target: `ws://127.0.0.1:${API_PORT}`,
        ws: true,
      },
    },
    fs: {
      // Allow Vite to serve files from the UI package source directly.
      allow: [
        path.resolve(__dirname, "src"),
        path.resolve(__dirname, "../ui/src"),
      ],
    },
  },
  css: {
    postcss: path.resolve(__dirname, "postcss.config.js"),
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    // WKWebView on macOS 14+ supports ES2022 (top-level await, etc.)
    target: "safari17",
  },
});
