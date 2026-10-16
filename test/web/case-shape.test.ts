import { describe, expect, test } from "bun:test";
import { applyDisplayRotation } from "../../src/web/keyboard/geometry.ts";
import { caseBounds, caseParts, convexHull, roundedPath } from "../../src/web/keyboard/case-shape.ts";

const load = async (dir: string) => {
  const board = await Bun.file(new URL(`../../boards/${dir}/board.json`, import.meta.url)).json();
  const geometry = await Bun.file(new URL(`../../boards/${dir}/geometry.json`, import.meta.url)).json();
  return { board, keys: applyDisplayRotation(geometry.keys, board.display) };
};

describe("a board's case (D-266)", () => {
  test("the Moonlander is drawn from the real object: a body and a hinged thumb module per half, with its tenting leg (D-277)", async () => {
    const { board, keys } = await load("zsa/moonlander");
    const parts = caseParts(keys, board.hands, board.display);
    expect(parts.filter((part) => part.kind === "body").map((part) => part.hand)).toEqual(["left", "right"]);
    expect(parts.filter((part) => part.kind === "module").map((part) => part.hand)).toEqual(["left", "right"]);
    expect(parts.filter((part) => part.kind === "leg")).toHaveLength(2);
    // Every key sits on its half's body or module, so the case is under the keys it belongs to.
    const bounds = caseBounds(parts.filter((part) => part.kind === "body" || part.kind === "module"));
    for (const key of keys) {
      expect(key.x).toBeGreaterThan(bounds?.minX ?? Infinity);
      expect(key.y).toBeGreaterThan(bounds?.minY ?? Infinity);
    }
  });

  test("the Glove80 is drawn from the real object: a sculpted body and a curved thumb module per half, with its column wells (D-341)", async () => {
    const { board, keys } = await load("moergo/glove80");
    const parts = caseParts(keys, board.hands, board.display);
    expect(parts.filter((part) => part.kind === "body").map((part) => part.hand)).toEqual(["left", "right"]);
    expect(parts.filter((part) => part.kind === "module").map((part) => part.hand)).toEqual(["left", "right"]);
    const thumbs = keys.filter((key) => key.r !== 0).length;
    expect(parts.filter((part) => part.kind === "well").length).toBeGreaterThan(thumbs);
    // The halves stand apart: the left half's case ends before the right half's begins, thumb modules included.
    const left = caseBounds(parts.filter((part) => part.hand === "left" && part.kind !== "well"));
    const right = caseBounds(parts.filter((part) => part.hand === "right" && part.kind !== "well"));
    expect((right?.minX ?? 0) - (left?.maxX ?? Infinity)).toBeGreaterThan(0.1);
    // A phone's one hand keeps only that hand's body, module and wells.
    expect(caseParts(keys, board.hands, board.display, "right").every((part) => part.hand === "right")).toBe(true);
  });

  test("the MacBook is one deck with its keyboard well, speaker grilles and Touch ID, though its hands interleave", async () => {
    const { board, keys } = await load("apple/macbook-ansi");
    const parts = caseParts(keys, board.hands, board.display);
    expect(parts.map((part) => part.kind)).toEqual(["deck", "recess", "grille", "grille", "sensor", "knurl"]);
    expect(parts.every((part) => part.hand === null)).toBe(true);
    // A phone shows one hand of the keys, on a deck around just those keys: the whole deck would run off the screen.
    expect(caseParts(keys, board.hands, board.display, "left").map((part) => part.kind)).toEqual(["deck", "recess"]);
    // The function row is drawn full height, as on a MacBook Pro, and the rows below it move down to make room.
    expect(keys[0]?.h).toBe(1);
    expect(keys[13]?.y).toBe(1);
  });

  test("the Corne is two PCBs, each with its OLED cover", async () => {
    const { board, keys } = await load("foostan/corne");
    expect(caseParts(keys, board.hands, board.display).map((part) => `${part.kind}:${part.hand}`)).toEqual(["body:left", "screen:left", "body:right", "screen:right"]);
  });

  test("a board with no display hints gets two plain bodies from its keys", async () => {
    const { board, keys } = await load("foostan/corne");
    expect(caseParts(keys, board.hands, undefined).map((part) => part.kind)).toEqual(["body", "body"]);
  });

  test("one hand on a phone draws only that hand's case", async () => {
    const { board, keys } = await load("zsa/moonlander");
    const parts = caseParts(keys, board.hands, board.display, "left");
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every((part) => part.hand === "left")).toBe(true);
  });
});

describe("outline helpers", () => {
  test("the hull keeps the outside corners only", () => {
    const hull = convexHull([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 0, y: 2 }]);
    expect(hull).toHaveLength(4);
  });

  test("a rounded path is closed, and each side of a corner rounds by at most half its own edge", () => {
    const d = roundedPath([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 10 }, { x: 0, y: 10 }], 5);
    expect(d.endsWith("Z")).toBe(true);
    // Along the 10-long edge the radius of 5 fits; along the 1-long edge it stops at 0.5.
    expect(d.startsWith("M0,5 Q0,0 0.5,0")).toBe(true);
  });
});

describe("the Moonlander's thumb modules mirror each other (P1 review)", () => {
  test("the right module has the left one's size, turned the other way", async () => {
    const { board, keys } = await load("zsa/moonlander");
    const modules = caseParts(keys, board.hands, board.display).filter((part) => part.kind === "module");
    const size = (d: string) => {
      const xs = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[1]));
      const ys = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[2]));
      return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), top: Math.min(...ys) };
    };
    const [left, right] = modules.map((part) => size(part.d));
    expect(Math.abs((left?.w ?? 0) - (right?.w ?? 0))).toBeLessThan(0.01);
    expect(Math.abs((left?.h ?? 0) - (right?.h ?? 0))).toBeLessThan(0.01);
    expect(Math.abs((left?.top ?? 0) - (right?.top ?? 0))).toBeLessThan(0.01);
  });

  test("the red thumb caps keep their firmware positions, reshaped as houses that sit on their modules", async () => {
    const { board, keys } = await load("zsa/moonlander");
    expect(board.display.keycaps).toEqual({ "59": "red", "60": "red" });
    expect(Object.keys(board.display.keyShapes)).toEqual(["59", "60"]);
    // The thumb keys turn with their module, inward on each half.
    for (const p of [59, 66, 67, 68]) expect(keys[p]?.r).toBe(51);
    for (const p of [60, 69, 70, 71]) expect(keys[p]?.r).toBe(-51);
    expect(keys[59]?.h).toBe(1.2);
    expect(keys[59]?.w).toBe(2);
  });
});

describe("case bounds", () => {
  test("reads M, L, Q and the end point of A", () => {
    expect(caseBounds([{ kind: "hole", hand: null, d: "M0,1 L2,1 Q3,0 3,4 A1,1 0 1,0 -1,2 Z" }])).toEqual({ minX: -1, minY: 0, maxX: 3, maxY: 4 });
  });
});
