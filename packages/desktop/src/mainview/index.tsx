import { installElectronApiShim } from "./bridge";
import "./index.css";

// Mark the desktop shell immediately — unconditional, before anything that can throw.
document.documentElement.classList.add('electron-app');

// Install the window.electronAPI shim (Electroview RPC bridge).
// Wrapped so a timing failure with window.__electrobun doesn't block mountApp.
try {
  installElectronApiShim();
} catch (err) {
  console.warn('[desktop] electronAPI shim failed (RPC unavailable):', err);
}

// Import AFTER the shim so the UI sees window.electronAPI during bootstrap.
const { mountApp } = await import("@remote-agent/ui/mount");

if (import.meta.env.DEV) {
  const { scan } = await import('react-scan');
  scan({ enabled: true });
}

mountApp(document.getElementById("root")!);
