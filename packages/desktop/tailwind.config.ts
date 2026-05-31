import type { Config } from "tailwindcss";
import uiConfig from "../ui/tailwind.config";

// Reuse the UI's theme verbatim, but widen `content` so classes used in the UI
// source (which we bundle from ../ui) are NOT purged when building the desktop
// view. Paths are relative to this config's location (packages/desktop).
export default {
  ...uiConfig,
  content: [
    "./src/mainview/**/*.{ts,tsx,html}",
    "../ui/index.html",
    "../ui/src/**/*.{ts,tsx}",
  ],
} satisfies Config;
