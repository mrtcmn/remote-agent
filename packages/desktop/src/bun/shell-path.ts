import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Recover the user's real login-shell PATH.
 *
 * NOTE: this is NEW behavior, not a port. The current Electron shell
 * (packages/electron/src/local-api.ts) does not recover the login-shell PATH —
 * it spawns the API with `...process.env` as-is. In a Finder/LaunchServices-
 * launched macOS app that inherits the stripped launchd PATH, the spawned API
 * server and its PTYs (claude, git, gh, bun) can fail to find tools. Electrobun's
 * launcher likewise does not synthesize a PATH, so we resolve it here and inject
 * it into the spawn env (see local-api.ts). Addresses Risk R4.
 *
 * Returns undefined on Windows (no login-shell concept) and on failure, in which
 * case the caller falls back to the inherited PATH.
 */
export function resolveShellPath(): string | undefined {
  if (process.platform === "win32") return undefined;
  const shell = process.env.SHELL || (existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash");
  const DELIM = "__RA_PATH_START__";
  try {
    const out = execSync(`${shell} -ilc 'echo "${DELIM}$PATH"'`, {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const match = out.match(new RegExp(`${DELIM}(.+)`));
    const resolved = match?.[1]?.trim();
    return resolved && resolved.length > 0 ? resolved : undefined;
  } catch {
    return undefined;
  }
}
