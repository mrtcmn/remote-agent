import { spawn, execSync, ChildProcess } from 'child_process';
import { app, net } from 'electron';
import path from 'path';
import { existsSync } from 'fs';
import { createServer } from 'net';

let apiProcess: ChildProcess | null = null;

function resolveBunPath(): string {
  // 1. Bundled bun binary (packaged app)
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'bun');
    if (existsSync(bundled)) return bundled;
  }

  // 2. Check if bun is on PATH
  try {
    const systemBun = execSync('which bun', { encoding: 'utf-8' }).trim();
    if (systemBun && existsSync(systemBun)) return systemBun;
  } catch {}

  // 3. Common install locations
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
  const bunPath = resolveBunPath();
  const apiDir = resolveApiDir();
  const port = await findAvailablePort(13590);
  const apiUrl = `http://localhost:${port}`;

  console.log(`[local-api] Using bun at: ${bunPath}`);
  console.log(`[local-api] API directory: ${apiDir}`);

  apiProcess = spawn(bunPath, ['run', 'src/index.ts'], {
    cwd: apiDir,
    env: {
      ...process.env,
      REMOTE_AGENT_MODE: 'local',
      PORT: String(port),
      REMOTE_AGENT_API: apiUrl,
      JWT_SECRET: 'local-mode-secret',
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
