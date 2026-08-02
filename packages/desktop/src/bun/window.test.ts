import { test, expect } from "bun:test";
import { visibleFrame } from "./window";

const primary = { workArea: { x: 0, y: 0, width: 1440, height: 900 }, isPrimary: true };
// Second monitor to the LEFT of primary => negative x origin.
const left = { workArea: { x: -1920, y: 0, width: 1920, height: 1080 }, isPrimary: false };

test("keeps a saved position that's still on a connected display", () => {
  const b = { x: 100, y: 80, width: 900, height: 700 };
  expect(visibleFrame(b, [primary, left])).toEqual(b);
});

test("keeps a position on a secondary monitor while it's attached", () => {
  const b = { x: -1800, y: 100, width: 900, height: 700 };
  expect(visibleFrame(b, [primary, left])).toEqual(b);
});

test("recenters onto primary when the saved monitor is gone", () => {
  // Was on the left monitor; now only primary is attached => off-screen.
  const b = { x: -1800, y: 100, width: 800, height: 600 };
  const f = visibleFrame(b, [primary]);
  expect(f).toEqual({ x: 320, y: 150, width: 800, height: 600 });
});

test("centers when there is no saved position", () => {
  const f = visibleFrame({ width: 800, height: 600 }, [primary]);
  expect(f).toEqual({ x: 320, y: 150, width: 800, height: 600 });
});

test("falls back to (0,0) when no displays are reported", () => {
  const b = { x: 50, y: 50, width: 800, height: 600 };
  expect(visibleFrame(b, [])).toEqual({ x: 0, y: 0, width: 800, height: 600 });
});
