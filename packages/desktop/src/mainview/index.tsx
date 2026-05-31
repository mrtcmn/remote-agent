import { installElectronApiShim } from "./bridge";
import "./index.css";

// Install the window.electronAPI shim synchronously, BEFORE the UI bundle's
// first module evaluates — the UI reads isElectron() at module-eval time
// (main.tsx / lib/api-config.ts), so the shim must exist first.
installElectronApiShim();

// Import AFTER the shim so the UI sees window.electronAPI during bootstrap.
const { mountApp } = await import("@remote-agent/ui/mount");
mountApp(document.getElementById("root")!);
