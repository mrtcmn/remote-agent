import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

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
    port: 13591,
    proxy: {
      "/api": {
        target: "http://localhost:13590",
        changeOrigin: false,
        cookieDomainRewrite: "localhost",
        secure: false,
      },
      "/ws": {
        target: "ws://localhost:13590",
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
