import { test, expect } from "bun:test";
import { resolveShellPath } from "./shell-path";

test("resolves a non-empty PATH on macOS/Linux", () => {
  if (process.platform === "win32") return; // returns undefined on Windows by design
  const path = resolveShellPath();
  expect(path).toBeTruthy();
  expect(path!.split(":").length).toBeGreaterThan(1);
});
