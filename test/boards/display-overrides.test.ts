import { describe, expect, test } from "bun:test";
import { getBoard } from "../../src/boards/registry.ts";
import { applyDisplayRotation, rotatedCorners, type Point } from "../../src/web/keyboard/geometry.ts";

const moonlander = getBoard("zsa/moonlander");
const { definition, geometry } = moonlander;
const display = definition.display;

// How far two convex polygons sink into each other (separating axis theorem); 0 or less means they only touch or are apart.
function penetration(a: Point[], b: Point[]): number {
  let least = Number.POSITIVE_INFINITY;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i] as Point;
      const q = poly[(i + 1) % poly.length] as Point;
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      const axis = { x: -(q.y - p.y) / length, y: (q.x - p.x) / length };
      const project = (points: Point[]) => {
        const values = points.map((point) => point.x * axis.x + point.y * axis.y);
        return [Math.min(...values), Math.max(...values)] as const;
      };
      const [aMin, aMax] = project(a);
      const [bMin, bMax] = project(b);
      least = Math.min(least, aMax - bMin, bMax - aMin);
    }
  }
  return least;
}

describe("the Moonlander's display overrides stay tied to the generated geometry (D-251)", () => {
  test("the overrides exist", () => {
    expect(display?.rotate?.length).toBe(2);
    expect(display?.shift?.length).toBe(1);
  });

  test("the keycap-coloured keys are the 2u thumb keys the firmware places on the bottom row", () => {
    const red = Object.keys(display?.keycaps ?? {}).map(Number);
    expect(red.sort()).toEqual(geometry.keys.flatMap((key, i) => (key.w === 2 ? [i] : [])).sort());
  });

  test("every rotated key is a thumb key: the two red keys and the 1.5u keys under them", () => {
    const rotated = (display?.rotate ?? []).flatMap((r) => r.positions).sort((a, b) => a - b);
    const expected = geometry.keys.flatMap((key, i) => (key.w === 2 || key.h === 1.5 ? [i] : []));
    expect(rotated).toEqual(expected);
  });

  test("each hand's rotation has the same angle, mirrored, about mirrored points", () => {
    const [left, right] = display?.rotate ?? [];
    expect(left?.r).toBe(-(right?.r ?? 0));
    expect(left?.ry).toBe(right?.ry);
    // Mirrored about the axis between the halves' inner columns: 8.5 before the right half slides.
    expect((left?.rx ?? 0) + (right?.rx ?? 0)).toBeCloseTo(17, 5);
  });

  test("the right half slides by exactly the right hand's positions", () => {
    expect([...(display?.shift?.[0]?.positions ?? [])].sort((a, b) => a - b)).toEqual([...definition.hands.right].sort((a, b) => a - b));
  });

  test("no two keys overlap as drawn, and the red key sits above its three-key arc", () => {
    const drawn = applyDisplayRotation(geometry.keys, display);
    const polygons = drawn.map(rotatedCorners);
    const overlaps: string[] = [];
    for (let i = 0; i < polygons.length; i++) {
      for (let j = i + 1; j < polygons.length; j++) {
        if (penetration(polygons[i]!, polygons[j]!) > 0.08) overlaps.push(`${i}/${j}`);
      }
    }
    expect(overlaps).toEqual([]);
    // Left hand: the red key (59) is higher on the page than every key of the arc (66-68).
    const centreY = (i: number) => polygons[i]!.reduce((s, p) => s + p.y, 0) / 4;
    for (const arc of [66, 67, 68]) expect(centreY(59)).toBeLessThan(centreY(arc));
    for (const arc of [69, 70, 71]) expect(centreY(60)).toBeLessThan(centreY(arc));
  });

  test("the generated file still has no rotation, so the override is the only place the tilt lives", () => {
    expect(geometry.keys.every((key) => key.r === 0)).toBe(true);
  });
});
