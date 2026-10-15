import { describe, expect, test } from "bun:test";
import { handTrays } from "../../src/web/keyboard/geometry.ts";

const box = (minX: number, width: number) => ({ minX, minY: 0, width, height: 4 });

describe("handTrays", () => {
  test("halves far apart get their keys' bounds grown by the pad", () => {
    expect(handTrays(box(0, 6), box(9, 6), 0.2, 0.2)).toEqual([
      { minX: -0.2, minY: -0.2, width: 6.4, height: 4.4 },
      { minX: 8.8, minY: -0.2, width: 6.4, height: 4.4 },
    ]);
  });

  test("halves whose grown trays would overlap each stop short of the midpoint between their keys", () => {
    // Keys end at 6.2 on the left and start at 6.6 on the right, like the Corne's tilted inner thumbs.
    const [l, r] = handTrays(box(0, 6.2), box(6.6, 6.2), 0.3, 0.1);
    expect(l.minX + l.width).toBeCloseTo(6.35);
    expect(r.minX).toBeCloseTo(6.45);
    expect(r.minX + r.width).toBeCloseTo(13.1);
    expect(l.minX).toBeCloseTo(-0.3);
  });

  test("tilted thumbs that overlap a hair in x still split at the middle; interleaved halves are left alone", () => {
    const [l, r] = handTrays(box(0, 7.004), box(6.996, 7.004), 0.18, 0.18);
    expect(l.minX + l.width).toBeCloseTo(6.91);
    expect(r.minX).toBeCloseTo(7.09);
    const [a, b] = handTrays(box(0, 8), box(6, 8), 0.2, 0.2);
    expect(a.width).toBeCloseTo(8.4);
    expect(b.minX).toBeCloseTo(5.8);
  });
});
