import { test, expect } from "bun:test";
import { findAvailablePort, waitForHealth } from "./net";

test("findAvailablePort returns a usable port >= start", async () => {
  const port = await findAvailablePort(13900);
  expect(port).toBeGreaterThanOrEqual(13900);
});

test("waitForHealth resolves when a server reports status ok", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(JSON.stringify({ status: "ok" }), {
        headers: { "content-type": "application/json" },
      }),
  });
  await waitForHealth(`http://localhost:${server.port}`, 5000);
  server.stop();
});
