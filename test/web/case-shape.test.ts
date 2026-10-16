import { describe, expect, test } from "bun:test";
import { applyDisplayRotation } from "../../src/web/keyboard/geometry.ts";
import { caseParts, convexHull, roundedPath } from "../../src/web/keyboard/case-shape.ts";

const load = async (dir: string) => {
  const board = await Bun.file(new URL(`../../boards/${dir}/board.json`, import.meta.url)).json();
  const geometry = await Bun.file(new URL(`../../boards/${dir}/geometry.json`, import.meta.url)).json();
  return { board, keys: applyDisplayRotation(geometry.keys, board.display) };
};

describe("a board's case (D-266)", () => {
  test("the Moonlander is two bodies plus two thumb modules, one per display rotation group", async () => {
    const { board, keys } = await load("zsa/moonlander");
    const parts = caseParts(keys, board.hands, board.display);
    expect(parts.filter((part) => part.kind === "body")).toHaveLength(4);
    // Modules are drawn after the bodies, so they sit on top where they meet.
    expect(parts.at(-1)?.kind).toBe("body");
  });

  test("the Glove80 is two hull bodies with a well per column and per thumb key", async () => {
    const { board, keys } = await load("moergo/glove80");
    const parts = caseParts(keys, board.hands, board.display);
    expect(parts.filter((part) => part.kind === "body")).toHaveLength(2);
    const thumbs = keys.filter((key) => key.r !== 0).length;
    expect(parts.filter((part) => part.kind === "well").length).toBeGreaterThan(thumbs);
  });

  test("the MacBook is one deck with a recess, though its hands interleave", async () => {
    const { board, keys } = await load("apple/macbook-ansi");
    expect(caseParts(keys, board.hands, board.display).map((part) => part.kind)).toEqual(["deck", "recess"]);
  });

  test("the Corne, with no display hints, is two plain bodies", async () => {
    const { board, keys } = await load("foostan/corne");
    expect(caseParts(keys, board.hands, board.display).map((part) => part.kind)).toEqual(["body", "body"]);
  });

  test("one hand on a phone draws only that hand's case", async () => {
    const { board, keys } = await load("zsa/moonlander");
    expect(caseParts(keys, board.hands, board.display, "left").filter((part) => part.kind === "body")).toHaveLength(2);
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
