import { describe, expect, test } from "bun:test";
import type { GeometryKey } from "../../src/boards/schema.ts";
import { neighbour } from "../../src/web/keyboard/navigate.ts";
import { moonlander } from "../helpers/board.ts";

const key = (x: number, y: number, extra: Partial<GeometryKey> = {}): GeometryKey => ({
  x,
  y,
  w: 1,
  h: 1,
  r: 0,
  rx: 0,
  ry: 0,
  ...extra,
});

describe("neighbour", () => {
  const grid = [key(0, 0), key(1, 0), key(0, 1), key(1, 1)];

  test("moves to the adjacent key in each direction", () => {
    expect(neighbour(grid, 0, "right")).toBe(1);
    expect(neighbour(grid, 0, "down")).toBe(2);
    expect(neighbour(grid, 3, "left")).toBe(2);
    expect(neighbour(grid, 3, "up")).toBe(1);
  });

  test("returns null at an edge", () => {
    expect(neighbour(grid, 0, "left")).toBeNull();
    expect(neighbour(grid, 0, "up")).toBeNull();
    expect(neighbour(grid, 3, "down")).toBeNull();
  });

  test("only keys that are on screen can be moved to (one hand at a time on a phone)", () => {
    const among = new Set([0, 2]);
    expect(neighbour(grid, 0, "right", among)).toBeNull();
    expect(neighbour(grid, 0, "down", among)).toBe(2);
  });

  test("an out-of-range start has no neighbour", () => {
    expect(neighbour(grid, 9, "left")).toBeNull();
  });

  test("Up stays in its column when a nearer key sits one column over", () => {
    const keys = [key(0, 2), key(0, 0), key(1, 1.2)];
    expect(neighbour(keys, 0, "up")).toBe(1);
  });

  test("on the Moonlander every key can be reached from key 1 by arrow keys alone", async () => {
    const { geometry } = await moonlander();
    const seen = new Set<number>([0]);
    const queue = [0];
    while (queue.length > 0) {
      const from = queue.shift() as number;
      for (const direction of ["left", "right", "up", "down"] as const) {
        const next = neighbour(geometry.keys, from, direction);
        if (next !== null && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect(seen.size).toBe(geometry.keys.length);
  });
});
