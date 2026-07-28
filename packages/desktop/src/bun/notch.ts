import { join } from "node:path";
import { existsSync, chmodSync } from "node:fs";
import { PATHS } from "electrobun/bun";
import type { Subprocess } from "bun";

let notchProcess: Subprocess | null = null;

// Launch the macOS notch companion so the desktop ships as one app. In a packaged
// build it's the release binary bundled at Resources/app/notch; in dev it falls back
// to the SwiftPM build under packages/notch. The notch sets its own .accessory
// activation policy in code, so the bare binary runs with no dock icon.
export function startNotch(apiUrl: string, deepLinkScheme?: string): void {
  if (process.platform !== "darwin" || notchProcess) return;

  const cmd = resolveNotch();
  if (!cmd) {
    console.warn("[notch] no binary found (bundled or dev build) — skipping");
    return;
  }

  notchProcess = Bun.spawn(cmd, {
    // RA_DEEPLINK_SCHEME (packaged only) makes the notch's "Open" deep-link into
    // this app instead of the browser.
    env: {
      ...process.env,
      RA_SERVER_URL: apiUrl,
      ...(deepLinkScheme ? { RA_DEEPLINK_SCHEME: deepLinkScheme } : {}),
    },
    stdout: "inherit",
    stderr: "inherit",
    onExit(_p, code) {
      console.log(`[notch] exited with code ${code}`);
      notchProcess = null;
    },
  });
  console.log(`[notch] launched → ${apiUrl}`);
}

function resolveNotch(): string[] | null {
  // Packaged (and dev, when copied into the bundle): the bundled release binary.
  const bundled = join(PATHS.RESOURCES_FOLDER, "app", "notch", "RemoteAgentNotch");
  if (existsSync(bundled)) {
    try { chmodSync(bundled, 0o755); } catch {} // the copy step can drop the +x bit
    return [bundled];
  }

  // Dev: the SwiftPM build in packages/notch (RA_NOTCH_DIR set by `desktop:dev`).
  const dir = process.env.RA_NOTCH_DIR || join(import.meta.dir, "..", "..", "..", "notch");
  if (!existsSync(join(dir, "Package.swift"))) return null;
  const release = join(dir, ".build", "release", "RemoteAgentNotch");
  const debug = join(dir, ".build", "debug", "RemoteAgentNotch");
  if (existsSync(release)) return [release];
  if (existsSync(debug)) return [debug];
  return ["swift", "run", "--package-path", dir]; // first-run dev: compile (~1 min)
}

export function stopNotch(): void {
  notchProcess?.kill();
  notchProcess = null;
}
