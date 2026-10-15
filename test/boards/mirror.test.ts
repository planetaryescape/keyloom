import { describe, expect, test } from "bun:test";
import { handOfPosition, mirrorPartners } from "../../src/boards/mirror.ts";
import { listBoards } from "../../src/boards/registry.ts";
import { applyDisplayRotation, rotatedCorners } from "../../src/web/keyboard/geometry.ts";

// The drawn centre of each key, so a rotated thumb cluster is compared where it sits on the picture.
const centre = (k: Parameters<typeof rotatedCorners>[0]) => {
  const corners = rotatedCorners(k);
  return { x: corners.reduce((s, p) => s + p.x, 0) / corners.length, y: corners.reduce((s, p) => s + p.y, 0) / corners.length };
};

describe("mirror maps of the shipped boards", () => {
  // A staggered laptop keyboard has no mirror image, so a software-remapper board leaves its mirror map empty (21).
  for (const board of listBoards().filter((b) => Object.keys(b.definition.mirror).length > 0)) {
    const { definition: d, geometry } = board;
    test(`${d.id}: every position has exactly one partner, on the other hand`, () => {
      const partners = mirrorPartners(d);
      expect(partners.size).toBe(d.keyCount);
      for (const [a, b] of partners) {
        expect(partners.get(b)).toBe(a);
        expect(a).not.toBe(b);
        expect(handOfPosition(d, a)).not.toBe(handOfPosition(d, b));
      }
    });

    test(`${d.id}: partners sit at the same height on opposite sides of one vertical axis, as drawn`, () => {
      const keys = applyDisplayRotation(geometry.keys, d.display);
      const axes: number[] = [];
      for (const [from, to] of Object.entries(d.mirror)) {
        const a = centre(keys[Number(from)]!);
        const b = centre(keys[to]!);
        expect(Math.abs(a.y - b.y)).toBeLessThan(0.05);
        axes.push((a.x + b.x) / 2);
      }
      expect(Math.max(...axes) - Math.min(...axes)).toBeLessThan(0.05);
    });

    test(`${d.id}: partners have the same finger name on the other hand`, () => {
      for (const [from, to] of Object.entries(d.mirror)) {
        const finger = (p: number | string) => (d.fingers[String(p)] ?? "").replace(/^(left|right)-/, "");
        expect(finger(to)).toBe(finger(from));
      }
    });
  }
});
