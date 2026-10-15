import { describe, expect, test } from "bun:test";
import { overlapArea, placeLabel, type Rect } from "../../src/web/keyboard/combo-labels.ts";

const size = { w: 30, h: 17 };
const box = (at: { x: number; y: number }): Rect => ({ x: at.x - size.w / 2, y: at.y - size.h / 2, w: size.w, h: size.h });
const horizontal = { x: 1, y: 0 };

describe("overlapArea", () => {
  test("is the shared area, and zero for boxes that only touch or are apart", () => {
    expect(overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(25);
    expect(overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(0);
    expect(overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 30, y: 30, w: 4, h: 4 })).toBe(0);
  });
});

describe("placeLabel", () => {
  test("stays in the middle of the line when nothing is there", () => {
    expect(placeLabel({ x: 100, y: 100 }, horizontal, 52, 52, size, [])).toEqual({ at: { x: 100, y: 100 }, covers: [] });
  });

  test("moves off a legend in the middle and covers none", () => {
    const legend: Rect = { x: 88, y: 92, w: 24, h: 16 };
    const placed = placeLabel({ x: 100, y: 100 }, horizontal, 52, 52, size, [legend]);
    expect(placed.covers).toEqual([]);
    expect(overlapArea(box(placed.at), legend)).toBe(0);
  });

  test("keeps clear of a rotated key's line too: the line runs at an angle, and the search follows it", () => {
    const along = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
    const legends: Rect[] = [{ x: 90, y: 90, w: 20, h: 20 }, { x: 60, y: 60, w: 20, h: 20 }];
    const placed = placeLabel({ x: 100, y: 100 }, along, 60, 52, size, legends);
    for (const legend of legends) expect(overlapArea(box(placed.at), legend)).toBe(0);
  });

  test("keeps clear of the labels already placed", () => {
    const earlier = box({ x: 100, y: 100 });
    const placed = placeLabel({ x: 100, y: 100 }, horizontal, 52, 52, size, [earlier]);
    expect(overlapArea(box(placed.at), earlier)).toBe(0);
  });

  test("covers the least it can when every spot is taken, and says which legends", () => {
    const wall: Rect = { x: -1000, y: -1000, w: 2000, h: 2000 };
    const small: Rect = { x: 99, y: 99, w: 2, h: 2 };
    const placed = placeLabel({ x: 100, y: 100 }, horizontal, 52, 52, size, [small, wall]);
    expect(placed.covers).toContain(1);
  });
});
