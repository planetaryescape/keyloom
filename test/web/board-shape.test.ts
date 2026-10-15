import { describe, expect, test } from "bun:test";
import { rememberShape, shapeFor } from "../../src/web/shell/shape.ts";

// Under bun there is no window, so storage is "blocked": the skeleton still has a board to draw.
describe("the skeleton's board shape", () => {
  test("without anything remembered it is a generic split board, never nothing", () => {
    const { keys, left } = shapeFor("zsa/moonlander");
    expect(keys.length).toBeGreaterThan(20);
    expect(keys.every((key) => key.w > 0 && key.h > 0)).toBe(true);
    // The generic board's left hand is the first half of its keys, which is what a phone's skeleton draws.
    expect(left).toHaveLength(keys.length / 2);
    expect(new Set(left).size).toBe(left.length);
  });

  test("remembering a shape when storage is unavailable does not throw", () => {
    expect(() => rememberShape("zsa/moonlander", [{ x: 0, y: 0, w: 1, h: 1, r: 0, rx: 0, ry: 0 }], [0])).not.toThrow();
  });
});
