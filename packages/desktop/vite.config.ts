import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Desktop renderer (Electrobun view) Vite config. Mirrors packages/ui/vite.config.ts
// but serves the mainview entry and bundles the UI source from ../ui.
//
// Risk R7 (highest in the plan): the Vite + Tailwind-over-workspace-UI wiring
// (aliases, content globs, package-exports CSS import) is the most failure-prone
// part of the migration and is UNVERIFIED here (vite/tailwind/react are not
// installed in this sandbox). Documented fallback if classes are missing or
// aliases break: build the UI in packages/ui as today and electrobun build.copy
// its dist/ directly, injecting the shim via a <script> in a postBuild hook.
export default defineConfig({
  root: "src/mainview",
  plugins: [react()],
  resolve: {
    alias: {
      // The UI's internal "@/..." imports must resolve to the UI source.
      "@": path.resolve(__dirname, "../ui/src"),
      // Package-name imports (@remote-agent/ui/mount, .../src/index.css) resolve
      // via the UI package's "exports" field; no alias needed for those.
    },
  },
  server: {
    port: 13591, // the dev URL the Electrobun main process loads (window.ts)
  },
  css: {
    postcss: path.resolve(__dirname, "postcss.config.js"),
  },
  build: {
    // Lands at packages/desktop/dist (matches electrobun.config.ts copy source).
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
});
