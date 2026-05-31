import { spawn, execSync, ChildProcess } from 'child_process';
import { app, net } from 'electron';
import path from 'path';
import { existsSync } from 'fs';
import { createServer } from 'net';

let apiProcess: ChildProcess | null = null;

/**
 * Resolve the user's real PATH by running their login+interactive shell.
 *
 * When the app is launched from Finder/Dock (production), macOS gives it the
 * minimal launchd PATH (/usr/bin:/bin:/usr/sbin:/sbin) instead of the PATH the
 * user has in their terminal. That minimal PATH propagates down to the API
 * server and every pty it spawns, so tools installed in ~/.local/bin,
 * /opt/homebrew/bin, npm/bun global bins, etc. (including `claude`) can't be
 * found — surfacing as `Executable not found in $PATH: "claude"`.
 *
 * Running the login shell sources the user's profile/rc files and gives us the
 * same PATH they'd have in a real terminal. Returns undefined on Windows or if
 * resolution fails, in which case the caller falls back to process.env.PATH.
 */
function resolveShellPath(): string | undefined {
  if (process.platform === 'win32') return undefined;

  const shell = process.env.SHELL
    || (existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash');
  const DELIM = '__RA_PATH_START__';

  try {
    // -i (interactive) + -l (login) ensures both .zprofile/.bash_profile and
    // .zshrc/.bashrc are sourced. A delimiter isolates the PATH from any banner
    // output rc files may print. 5s timeout guards against hanging rc files.
    const out = execSync(`${shell} -ilc 'echo "${DELIM}$PATH"'`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const match = out.match(new RegExp(`${DELIM}(.+)`));
    const resolved = match?.[1]?.trim();
    return resolved && resolved.length > 0 ? resolved : undefined;
  } catch {
    return undefined;
  }
}

function resolveBunPath(): string {
  // Dev mode only - find a local bun installation
  try {
    const systemBun = execSync('which bun', { encoding: 'utf-8' }).trim();
    if (systemBun && existsSync(systemBun)) return systemBun;
  } catch {}

  const home = process.env.HOME || '';
  const candidates = [
    path.join(home, '.bun', 'bin', 'bun'),
    '/usr/local/bin/bun',
    '/opt/homebrew/bin/bun',
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    'Bun runtime not found. Install it with: curl -fsSL https://bun.sh/install | bash'
  );
}

function resolveServerBinary(apiDir: string): string {
  const binaryName = process.platform === 'win32' ? 'server.exe' : 'server';
  return path.join(apiDir, 'dist', binaryName);
}

function resolveApiDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'api');
  }
  // Dev mode: API is a sibling package
  return path.join(__dirname, '..', '..', 'api');
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found in range ${startPort}-${startPort + 99}`);
}

async function waitForHealth(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await net.fetch(`${url}/health`);
      if (response.ok) {
        const data = await response.json() as Record<string, unknown>;
        if (data.status === 'ok') return;
      }
    } catch {
      // Not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Local API did not become healthy within ${timeoutMs}ms`);
}

export async function startLocalApi(): Promise<string> {
  const apiDir = resolveApiDir();
  const port = await findAvailablePort(13590);
  const apiUrl = `http://localhost:${port}`;

  let command: string;
  let args: string[];

  if (app.isPackaged) {
    const binaryPath = resolveServerBinary(apiDir);
    if (!existsSync(binaryPath)) {
      throw new Error(`Compiled API binary not found at ${binaryPath}`);
    }
    command = binaryPath;
    args = [];
    console.log(`[local-api] Using compiled binary: ${binaryPath}`);
  } else {
    command = resolveBunPath();
    args = ['run', 'src/index.ts'];
    console.log(`[local-api] Using bun at: ${command}`);
  }

  console.log(`[local-api] API directory: ${apiDir}`);

  // When launched from Finder/Dock the app inherits the minimal launchd PATH,
  // which omits ~/.local/bin, homebrew, npm/bun global bins, etc. Recover the
  // user's real shell PATH so the API server and every pty it spawns (claude,
  // git, gh, node, …) can find their executables.
  const shellPath = resolveShellPath();
  if (shellPath) {
    console.log(`[local-api] Resolved shell PATH (${shellPath.split(':').length} entries)`);
  } else {
    console.warn('[local-api] Could not resolve shell PATH; using inherited PATH');
  }

  apiProcess = spawn(command, args, {
    cwd: apiDir,
    env: {
      ...process.env,
      ...(shellPath ? { PATH: shellPath } : {}),
      // All vars bound by the local launcher use the `RA_` (Remote Agent)
      // namespace so we don't clobber any standard-named vars the user
      // already has in their shell (e.g. JWT_SECRET, PORT, NODE_ENV).
      // The API reads RA_* first with fallback to the legacy names for
      // production deploy compatibility.
      RA_MODE: 'local',
      RA_PORT: String(port),
      RA_API_URL: apiUrl,
      RA_JWT_SECRET: 'local-mode-secret',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  apiProcess.stdout?.on('data', (data: Buffer) => {
    console.log(`[local-api] ${data.toString().trim()}`);
  });

  apiProcess.stderr?.on('data', (data: Buffer) => {
    console.error(`[local-api] ${data.toString().trim()}`);
  });

  apiProcess.on('exit', (code) => {
    console.log(`[local-api] Process exited with code ${code}`);
    apiProcess = null;
  });

  await waitForHealth(apiUrl);
  console.log(`[local-api] Running on ${apiUrl}`);

  return apiUrl;
}

export function stopLocalApi(): void {
  if (apiProcess) {
    apiProcess.kill('SIGTERM');
    apiProcess = null;
  }
}

export function isLocalApiRunning(): boolean {
  return apiProcess !== null;
}
