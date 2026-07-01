import { createServer } from "node:net";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port, "127.0.0.1");
  });
}

/** Ported from packages/electron/src/local-api.ts (findAvailablePort). */
export async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port in ${startPort}-${startPort + 99}`);
}

/**
 * Ported from packages/electron/src/local-api.ts (waitForHealth), using the
 * global Bun `fetch` instead of Electron's `net.fetch`. Matches the API's
 * /health contract: { status: "ok", ... }.
 */
export async function waitForHealth(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        if (data.status === "ok") return;
      }
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Local API not healthy within ${timeoutMs}ms`);
}
