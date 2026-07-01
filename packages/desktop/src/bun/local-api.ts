import { PATHS } from "electrobun/bun";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Subprocess } from "bun";
import { resolveShellPath } from "./shell-path";
import { findAvailablePort, waitForHealth } from "./net";

let apiProcess: Subprocess | null = null;

function resolveServerEntry(): string {
  // Packaged: Contents/Resources/app/server/index.js (runtime cwd is Contents/MacOS).
  const packaged = join(PATHS.RESOURCES_FOLDER, "app", "server", "index.js");
  if (existsSync(packaged)) return packaged;
  // Dev: built into the desktop package by `build:server`.
  return join(import.meta.dir, "..", "..", "dist-server", "index.js");
}

function resolveBunRuntime(): string {
  // Vendored Bun next to the launcher at Contents/MacOS/bun.
  const vendored = join(PATHS.RESOURCES_FOLDER, "..", "MacOS", "bun");
  if (existsSync(vendored)) return vendored;
  return process.execPath; // dev: the Bun running this process
}

export async function startLocalApi(): Promise<string> {
  const port = await findAvailablePort(13590);
  const apiUrl = `http://localhost:${port}`;
  const serverEntry = resolveServerEntry();
  const bun = resolveBunRuntime();

  if (!existsSync(serverEntry)) {
    throw new Error(`Server bundle not found at ${serverEntry} (run \`bun run build:server\`)`);
  }

  const shellPath = resolveShellPath();

  apiProcess = Bun.spawn([bun, serverEntry], {
    // R5: the API reads ../ui/dist + sqlite migrations relative to cwd; the bundle
    // dir is the reference point (matches packages/electron local-api cwd=apiDir).
    // Verify the packaged copy layout on first `electrobun build`.
    cwd: join(serverEntry, ".."),
    env: {
      ...process.env,
      ...(shellPath ? { PATH: shellPath } : {}),
      // Correct env-var names verified against packages/api/src/index.ts and
      // packages/electron/src/local-api.ts (NOT the plan's RA_* names).
      REMOTE_AGENT_MODE: "local",
      PORT: String(port),
      REMOTE_AGENT_API: apiUrl,
      JWT_SECRET: "local-mode-secret",
    },
    stdout: "inherit",
    stderr: "inherit",
    onExit(_p, code) {
      console.log(`[local-api] exited with code ${code}`);
      apiProcess = null;
    },
  });

  await waitForHealth(apiUrl);
  console.log(`[local-api] running on ${apiUrl}`);
  return apiUrl;
}

export function stopLocalApi(): void {
  apiProcess?.kill();
  apiProcess = null;
}
