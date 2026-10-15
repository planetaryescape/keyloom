import { describe, expect, test } from "bun:test";
import { checkBoardDir } from "../../src/boards/check.ts";
import { GeometryError, generateGeometry, serializeGeometry } from "../../src/boards/geometry.ts";
import { loadBoardDir } from "../../src/boards/load.ts";
import { getBoard } from "../../src/boards/registry.ts";
import { parsePhysicalLayout } from "../../src/boards/zmk-geometry.ts";
import { GLOVE80_DIR, glove80 } from "../helpers/zmk.ts";

const dtsi = await Bun.file(`${import.meta.dir}/../fixtures/zmk/glove80-physical-layout/glove80-layouts.dtsi`).text();
const offlineFetch = async (url: string): Promise<string> => {
  if (url.endsWith("/ce69e85f585c724142aae37ddf8a7e019ff19e93/app/boards/arm/glove80/glove80-layouts.dtsi")) return dtsi;
  throw new Error(`unexpected fetch ${url}`);
};

describe("parsePhysicalLayout", () => {
  test("reads w h x y r rx ry in hundredths, with negatives in parentheses, and ignores comments", () => {
    const keys = parsePhysicalLayout(`
      keys // w h x y rot rx ry
        = <&key_physical_attrs 100 100 50 150 0 0 0>
        , <&key_physical_attrs 100 150 (-300) 25 (-3000) 450 925> /* a comment */
        // , <&key_physical_attrs 1 1 1 1 1 1 1>
        ;`);
    expect(keys).toEqual([
      { x: 0.5, y: 1.5, w: 1, h: 1, r: 0, rx: 0, ry: 0 },
      { x: -3, y: 0.25, w: 1, h: 1.5, r: -30, rx: 4.5, ry: 9.25 },
    ]);
  });

  test("a file with no keys is an error", () => {
    expect(() => parsePhysicalLayout("/ { };")).toThrow(GeometryError);
  });
});

describe("the Glove80 board", () => {
  test("geometry.json is what the pinned firmware tree's physical layout gives", async () => {
    const { definition, geometry } = await glove80();
    const regenerated = await generateGeometry(definition, definition.revisions[0]!, { fetchText: offlineFetch });
    expect(serializeGeometry(regenerated)).toBe(serializeGeometry(geometry));
    expect(geometry.keys).toHaveLength(80);
    expect(geometry.source).toEqual({ repo: "https://github.com/moergo-sc/zmk", sha: "ce69e85f585c724142aae37ddf8a7e019ff19e93", path: "app/boards/arm/glove80/glove80-layouts.dtsi" });
    // Twelve keys are rotated: the thumb clusters.
    expect(geometry.keys.filter((k) => k.r !== 0)).toHaveLength(12);
  });

  test("the folder passes boards check, offline and against the pinned tree", async () => {
    expect(await checkBoardDir(GLOVE80_DIR, { offline: true })).toEqual({ ok: true, issues: [] });
    expect(await checkBoardDir(GLOVE80_DIR, { fetchText: offlineFetch })).toEqual({ ok: true, issues: [] });
  });

  test("a changed geometry is reported as drift", async () => {
    const changed = dtsi.replace("<&key_physical_attrs 100 100    0   50 ", "<&key_physical_attrs 100 100    0   60 ");
    expect(changed).not.toBe(dtsi);
    const r = await checkBoardDir(GLOVE80_DIR, { fetchText: async () => changed });
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.message).toContain("geometry.json differs from app/boards/arm/glove80/glove80-layouts.dtsi");
  });

  test("it is registered, ZMK, pinned to MoErgo's fork at the v26.09 tag and to the template's commit", () => {
    const b = getBoard("moergo/glove80");
    expect(b.definition).toMatchObject({ firmware: "zmk", keyCount: 80, importers: ["zmk-layout-editor-keymap"] });
    const rev = b.definition.revisions[0]!;
    expect(rev.source).toEqual({ repo: "https://github.com/moergo-sc/zmk", ref: "v26.09", sha: "ce69e85f585c724142aae37ddf8a7e019ff19e93" });
    expect(rev.build).toMatchObject({ kind: "zmk-moergo-template", template: { sha: "34888be8c9d9a3d5b168a502b8b191ba43b4a1f3" } });
    expect(rev.detect).toEqual({ usbProductId: "0x27db" });
    expect((rev.flash as { steps: Array<{ volume: string }> }).steps.map((s) => s.volume)).toEqual(["GLV80RHBOOT", "GLV80LHBOOT"]);
  });

  test("every position has a hand, a finger and a mirror, and the thumb keys are the rotated ones", async () => {
    const { definition, geometry } = await loadBoardDir(GLOVE80_DIR);
    const rotated = geometry.keys.flatMap((k, i) => (k.r !== 0 ? [i] : [])).sort((a, b) => a - b);
    expect([...(definition.rows.thumb ?? [])].sort((a, b) => a - b)).toEqual(rotated);
    // Mirroring a left key lands on the right-hand key at the same height, as far from the right edge as it is from the left.
    for (const [from, to] of Object.entries(definition.mirror)) {
      const a = geometry.keys[Number(from)]!;
      const b = geometry.keys[to]!;
      expect(b.y).toBeCloseTo(a.y, 5);
      if (a.r === 0) expect(b.x).toBeCloseTo(17 - a.x, 5);
      else expect(b.r).toBeCloseTo(-a.r, 5);
    }
    expect(definition.fingers["34"]).toBe("left-pinky");
    expect(definition.fingers["38"]).toBe("left-index");
    expect(definition.fingers["52"]).toBe("left-thumb");
    expect(definition.rows.home).toEqual([34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45]);
  });
});
