import { describe, expect, test } from "bun:test";
import { handOfPosition, mirrorPartners, mirrorProblems } from "../../src/boards/mirror.ts";
import { isOnePiece } from "../../src/boards/one-piece.ts";
import { listBoards } from "../../src/boards/registry.ts";
import { applyDisplayRotation, rotatedCorners } from "../../src/web/keyboard/geometry.ts";
import { moonlander } from "../helpers/board.ts";

// The drawn centre of each key, so a rotated thumb cluster is compared where it sits on the picture.
const centre = (k: Parameters<typeof rotatedCorners>[0]) => {
  const corners = rotatedCorners(k);
  return { x: corners.reduce((s, p) => s + p.x, 0) / corners.length, y: corners.reduce((s, p) => s + p.y, 0) / corners.length };
};

const rowOf = (rows: Record<string, number[]>, p: number) => Object.entries(rows).find(([, positions]) => positions.includes(p))?.[0];

describe("mirror maps of the shipped boards", () => {
  for (const board of listBoards()) {
    const { definition: d, geometry } = board;
    // Two halves of one size, drawn apart, are the boards whose drawing is a mirror image (D-350). An uneven thumb cluster
    // (the Charybdis) or a one-piece board (a 60%, a laptop) pairs what it can and leaves the rest out.
    const symmetric = d.hands.left.length === d.hands.right.length && !isOnePiece(d, geometry.keys) && Object.keys(d.mirror).length > 0;

    test(`${d.id}: each pair is a left key and a right key on one row, under the same finger, and no key is paired twice`, () => {
      const partners = mirrorPartners(d);
      expect(partners.size).toBe(2 * Object.keys(d.mirror).length);
      for (const [a, b] of partners) {
        expect(partners.get(b)).toBe(a);
        expect(handOfPosition(d, a)).not.toBe(handOfPosition(d, b));
        expect(rowOf(d.rows, a)).toBe(rowOf(d.rows, b));
        const finger = (p: number) => (d.fingers[String(p)] ?? "").replace(/^(left|right)-/, "");
        expect(finger(a)).toBe(finger(b));
      }
      for (const from of Object.keys(d.mirror)) expect(handOfPosition(d, Number(from))).toBe("left");
    });

    if (symmetric) {
      test(`${d.id}: every key has a partner at the same height on the other side of one vertical axis, as drawn`, () => {
        expect(mirrorPartners(d).size).toBe(d.keyCount);
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
    }
  }

  test("the boards that must be mirror images are checked as such", () => {
    const symmetric = listBoards()
      .filter(({ definition: d, geometry }) => d.hands.left.length === d.hands.right.length && !isOnePiece(d, geometry.keys) && Object.keys(d.mirror).length > 0)
      .map((b) => b.definition.id);
    expect(symmetric).toEqual(expect.arrayContaining(["foostan/corne", "moergo/glove80", "zsa/moonlander"]));
  });
});

describe("mirror rules", () => {
  test("a target used twice, a pair across rows and a pair across fingers are each named", async () => {
    const { definition } = await moonlander();
    const top = definition.rows.top!;
    const home = definition.rows.home!;
    const base = { ...definition, mirror: {} as Record<string, number> };
    const twice = mirrorProblems({ ...base, mirror: { [String(home[1])]: home.at(-2)!, [String(home[2])]: home.at(-2)! } });
    expect(twice).toContain(`mirror target ${home.at(-2)} is used twice`);
    const rows = mirrorProblems({ ...base, mirror: { [String(top[1])]: home.at(-2)! } });
    expect(rows.some((m) => m.includes("crosses rows"))).toBe(true);
    const fingers = mirrorProblems({ ...base, mirror: { [String(home[1])]: home.at(-3)! } });
    expect(fingers.some((m) => m.includes("finger"))).toBe(true);
  });

  test("unpaired keys and an empty map are not problems", async () => {
    const { definition } = await moonlander();
    expect(mirrorProblems({ ...definition, mirror: {} })).toEqual([]);
    const [first] = Object.entries(definition.mirror);
    expect(mirrorProblems({ ...definition, mirror: Object.fromEntries([first!]) })).toEqual([]);
  });

  test("a drawn one-piece case, or halves with no gap, make a board one piece; a split board's halves don't", async () => {
    const { definition, geometry } = await moonlander();
    expect(isOnePiece(definition, geometry.keys)).toBe(false);
    expect(isOnePiece({ ...definition, display: { case: [{ hand: null, kind: "body", d: "M0,0 L1,0 L1,1 Z" }] } }, geometry.keys)).toBe(true);
    const closed = geometry.keys.map((k, p) => (definition.hands.right.includes(p) ? { ...k, x: k.x - 1 } : k));
    expect(isOnePiece({ ...definition, display: {} }, closed)).toBe(true);
  });
});
