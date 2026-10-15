import { describe, expect, test } from "bun:test";
import type { GeometryKey } from "../../src/boards/schema.ts";
import { applyDisplayRotation, boardBounds, keyRect, rotatedCorners } from "../../src/web/keyboard/geometry.ts";

function key(overrides: Partial<GeometryKey> & Pick<GeometryKey, "x" | "y">): GeometryKey {
  return { w: 1, h: 1, r: 0, rx: 0, ry: 0, ...overrides };
}

describe("rotatedCorners", () => {
  test("an unrotated key keeps its corners", () => {
    expect(rotatedCorners(key({ x: 2, y: 3, w: 2, h: 1 }))).toEqual([
      { x: 2, y: 3 },
      { x: 4, y: 3 },
      { x: 4, y: 4 },
      { x: 2, y: 4 },
    ]);
  });

  test("a positive angle turns clockwise on screen, about the rotation origin", () => {
    // Rotating the unit square at the origin by 90 degrees maps (1, 0) to (0, 1).
    const corners = rotatedCorners(key({ x: 1, y: 0, r: 90, rx: 0, ry: 0 }));
    expect(corners[1]?.x).toBeCloseTo(0);
    expect(corners[1]?.y).toBeCloseTo(2);
    expect(corners[0]?.x).toBeCloseTo(0);
    expect(corners[0]?.y).toBeCloseTo(1);
  });

  test("a thumb key rotates about its own origin, not the board origin", () => {
    // A key at (5, 5) rotated 30 degrees about (5, 5) keeps its top-left corner in place.
    const corners = rotatedCorners(key({ x: 5, y: 5, r: 30, rx: 5, ry: 5 }));
    expect(corners[0]?.x).toBeCloseTo(5);
    expect(corners[0]?.y).toBeCloseTo(5);
  });
});

describe("boardBounds", () => {
  test("unrotated keys give their plain extent", () => {
    const bounds = boardBounds([key({ x: 0, y: 0 }), key({ x: 3, y: 1.5, w: 2 })]);
    expect(bounds).toEqual({ minX: 0, minY: 0, width: 5, height: 2.5 });
  });

  test("rotated keys can extend the canvas into negative space, and it is measured from the minimum", () => {
    // Corners land at (0,1), (0,2), (-1,2) and (-1,1).
    const bounds = boardBounds([key({ x: 1, y: 0, r: 90, rx: 0, ry: 0 })]);
    expect(bounds.minX).toBeCloseTo(-1);
    expect(bounds.minY).toBeCloseTo(1);
    expect(bounds.width).toBeCloseTo(1);
    expect(bounds.height).toBeCloseTo(1);
  });

  test("an empty layout has an empty canvas", () => {
    expect(boardBounds([])).toEqual({ minX: 0, minY: 0, width: 0, height: 0 });
  });
});

describe("keyRect", () => {
  test("positions the unrotated box relative to the canvas", () => {
    const bounds = boardBounds([key({ x: 0, y: 0 }), key({ x: 2, y: 1, rx: 2, ry: 1 })]);
    expect(keyRect(key({ x: 2, y: 1, rx: 2, ry: 1 }), bounds)).toEqual({
      left: 2,
      top: 1,
      width: 1,
      height: 1,
      rotate: 0,
      originX: 0,
      originY: 0,
    });
  });

  test("keeps the rotation origin relative to the key's own box", () => {
    const thumb = key({ x: 1, y: 0, r: 90, rx: 0, ry: 0 });
    const bounds = boardBounds([thumb]);
    const rect = keyRect(thumb, bounds);
    expect(rect.left).toBeCloseTo(2);
    expect(rect.top).toBeCloseTo(-1);
    expect(rect.rotate).toBe(90);
    expect(rect.originX).toBeCloseTo(-1);
    expect(rect.originY).toBeCloseTo(0);
  });
});

describe("applyDisplayRotation", () => {
  const keys = [key({ x: 0, y: 0 }), key({ x: 1, y: 0 }), key({ x: 2, y: 0 })];

  test("without a display section the keys are returned unchanged", () => {
    expect(applyDisplayRotation(keys, undefined)).toEqual(keys);
  });

  test("only the listed positions get the rotation", () => {
    const out = applyDisplayRotation(keys, { rotate: [{ positions: [2], r: 15, rx: 2, ry: 1 }] });
    expect(out.map((k) => k.r)).toEqual([0, 0, 15]);
    expect(out[2]).toMatchObject({ rx: 2, ry: 1 });
  });

  test("shift slides only the listed positions, with their rotation pivot", () => {
    const out = applyDisplayRotation(keys, {
      rotate: [{ positions: [1], r: 10, rx: 1, ry: 1 }],
      shift: [{ positions: [1, 2], dx: 2 }],
    });
    expect(out.map((k) => k.x)).toEqual([0, 3, 4]);
    expect(out[1]).toMatchObject({ r: 10, rx: 3, ry: 1 });
    expect(out[0]).toMatchObject({ rx: 0 });
  });

  test("a shift past the geometry throws", () => {
    expect(() => applyDisplayRotation(keys, { shift: [{ positions: [9], dx: 1 }] })).toThrow(/key 9/);
  });

  test("the input keys are not mutated", () => {
    applyDisplayRotation(keys, { rotate: [{ positions: [0], r: 30, rx: 0, ry: 0 }] });
    expect(keys[0]?.r).toBe(0);
  });

  test("a position outside the geometry throws rather than being skipped", () => {
    expect(() => applyDisplayRotation(keys, { rotate: [{ positions: [3], r: 1, rx: 0, ry: 0 }] })).toThrow(
      /key 3/,
    );
  });
});
