import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Subprocess } from "bun";

let notchProcess: Subprocess | null = null;

// Dev-only companion: auto-launch the notch app (packages/notch) alongside the
// desktop shell. Packaged builds don't ship it — it's a standalone app.
export function startNotch(apiUrl: string): void {
  if (process.platform !== "darwin" || notchProcess) return;

  const notchDir = join(import.meta.dir, "..", "..", "..", "notch");
  if (!existsSync(join(notchDir, "Package.swift"))) return;

  const releaseBin = join(notchDir, ".build", "release", "RemoteAgentNotch");
  const debugBin = join(notchDir, ".build", "debug", "RemoteAgentNotch");
  const bin = existsSync(releaseBin) ? releaseBin : existsSync(debugBin) ? debugBin : null;

  // ponytail: no prebuilt binary → `swift run` (first run compiles, ~1 min)
  const cmd = bin ? [bin] : ["swift", "run"];
  notchProcess = Bun.spawn(cmd, {
    cwd: notchDir,
    env: { ...process.env, RA_SERVER_URL: apiUrl },
    stdout: "inherit",
    stderr: "inherit",
    onExit(_p, code) {
      console.log(`[notch] exited with code ${code}`);
      notchProcess = null;
    },
  });
  console.log(`[notch] launched (${bin ? "prebuilt" : "swift run"}) → ${apiUrl}`);
}

export function stopNotch(): void {
  notchProcess?.kill();
  notchProcess = null;
}
