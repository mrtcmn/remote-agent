import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "./store";

test("returns schema defaults when no file exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "ra-store-"));
  const store = createStore(dir);
  expect(store.get("mode")).toBe("local");
  expect(store.get("apiUrl")).toBe("");
  expect(store.get("windowBounds")).toEqual({ width: 1200, height: 800 });
});

test("persists and reloads values across instances", () => {
  const dir = mkdtempSync(join(tmpdir(), "ra-store-"));
  const a = createStore(dir);
  a.set("apiUrl", "http://localhost:13590");
  a.set("windowBounds", { x: 10, y: 20, width: 900, height: 700 });
  const b = createStore(dir);
  expect(b.get("apiUrl")).toBe("http://localhost:13590");
  expect(b.get("windowBounds")).toEqual({ x: 10, y: 20, width: 900, height: 700 });
});
