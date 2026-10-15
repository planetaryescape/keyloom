import { describe, expect, test } from "bun:test";
import { applyOps } from "../../src/layout/apply-ops.ts";
import { colourAt, hexToHsv, hsvToHex } from "../../src/layout/colour.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { staleConflicts } from "../../src/layout/stale.ts";
import { effectiveDraft, lightingOps, lightingWords, withKeyColour, withLayerColour, withLighting } from "../../src/web/settings/lighting-ops.ts";
import { evaluate } from "../../src/validation/validate.ts";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";

const board = (await moonlander()).definition;
const layout: Layout = (await importOryxSource(FIXTURE_DIR, board)).layout;
const NAV = "layer-1";

describe("colour choices", () => {
  test("a layer colour keeps the keys' own colours, and dark drops the layer colour only", () => {
    const l = withLayerColour({ layer: [1, 2, 3], keys: { "4": [5, 6, 7] } }, [85, 255, 255]);
    expect(l).toEqual({ layer: [85, 255, 255], keys: { "4": [5, 6, 7] } });
    expect(withLayerColour(l, [0, 0, 0])).toEqual({ keys: { "4": [5, 6, 7] } });
  });

  test("a key colour is set and cleared without touching the rest, and the last one out removes the map", () => {
    const a = withKeyColour({ layer: [1, 2, 3] }, 7, [9, 9, 9]);
    expect(a).toEqual({ layer: [1, 2, 3], keys: { "7": [9, 9, 9] } });
    expect(withKeyColour(a, 7, null)).toEqual({ layer: [1, 2, 3] });
  });

  test("a key with its own colour wins over its layer's; one with neither is dark", () => {
    expect(colourAt({ lighting: { layer: [1, 2, 3], keys: { "4": [5, 6, 7] } } }, 4)).toEqual([5, 6, 7]);
    expect(colourAt({ lighting: { layer: [1, 2, 3] } }, 4)).toEqual([1, 2, 3]);
    expect(colourAt({ lighting: { keys: {} } }, 4)).toEqual([0, 0, 0]);
    expect(colourAt({}, 4)).toEqual([0, 0, 0]);
  });

  test("hex and HSV agree to within a rounding step, so a picked colour comes back as itself", () => {
    expect(hsvToHex([0, 255, 255])).toBe("#ff0000");
    expect(hsvToHex([85, 255, 255])).toBe("#02ff00"); // 85/256 of the wheel is a hair short of pure green
    expect((hexToHsv("#0000ff") as number[])[0]).toBeGreaterThanOrEqual(170); // 170.67 of 256 rounds up
    for (const hex of ["#12ab34", "#ffffff", "#808080", "#f0c978"]) {
      const back = hsvToHex(hexToHsv(hex) as [number, number, number]);
      const diff = [1, 3, 5].map((o) => Math.abs(Number.parseInt(hex.slice(o, o + 2), 16) - Number.parseInt(back.slice(o, o + 2), 16)));
      expect(Math.max(...diff)).toBeLessThanOrEqual(3);
    }
  });
});

describe("the staged colours", () => {
  test("an edit that changes nothing is no edit, and a cleared layer is an op with null", () => {
    const same = new Map([[NAV, layout.layers[1]?.lighting ?? null]]);
    expect(effectiveDraft(layout, same).size).toBe(0);
    expect(lightingOps(layout, new Map([[NAV, null]]))).toEqual([{ op: "setLayerLighting", layerId: NAV, lighting: null }]);
  });

  test("the board draws the staged colours before they are applied, and the document is not touched", () => {
    const draft = new Map([[NAV, { layer: [85, 255, 255] as [number, number, number] }]]);
    expect(withLighting(layout, draft).layers[1]?.lighting).toEqual({ layer: [85, 255, 255] });
    expect(layout.layers[1]?.lighting).toEqual({ layer: [188, 255, 255] });
  });

  test("the history line names the layer and the colour", () => {
    expect(lightingWords(layout, new Map([[NAV, { layer: [85, 255, 255] as [number, number, number], keys: { "1": [21, 255, 255] as [number, number, number], "2": [21, 255, 255] as [number, number, number] } }]]))).toEqual(["Layer 1 green with 2 keys coloured"]);
  });
});

describe("setLayerLighting", () => {
  test("applies, clears, and refuses a position the layer doesn't have", () => {
    const set = applyOps(layout, [{ op: "setLayerLighting", layerId: "layer-3", lighting: { layer: [1, 2, 3] } }]);
    expect(set.ok && set.layout.layers[3]?.lighting).toEqual({ layer: [1, 2, 3] });
    const cleared = applyOps(layout, [{ op: "setLayerLighting", layerId: NAV, lighting: null }]);
    expect(cleared.ok && cleared.layout.layers[1]?.lighting).toBeUndefined();
    const far = applyOps(layout, [{ op: "setLayerLighting", layerId: NAV, lighting: { keys: { "72": [1, 2, 3] } } }]);
    expect(far.ok).toBe(false);
  });

  test("the validator refuses colours on a board with no per-key RGB, and on a key the board doesn't have", () => {
    const { lighting, ...noRgb } = board;
    void lighting;
    const ops = [{ op: "setLayerLighting" as const, layerId: "layer-3", lighting: { layer: [1, 2, 3] as [number, number, number] } }];
    const on = evaluate(board, layout, ops);
    expect(on.result.errors.map((e) => e.code)).not.toContain("lighting_unsupported");
    const off = evaluate(noRgb, layout, ops);
    expect(off.result.errors.map((e) => e.code)).toContain("lighting_unsupported");
  });

  test("a stale base is safe for a colour edit on another layer and a conflict on the same one", () => {
    const head: Layout = { ...layout, layers: layout.layers.map((l) => (l.id === "layer-2" ? { ...l, lighting: { layer: [1, 1, 1] as [number, number, number] } } : l)) };
    const op = (layerId: string) => [{ op: "setLayerLighting" as const, layerId, lighting: null }];
    expect(staleConflicts(layout, head, op(NAV))).toEqual([]);
    expect(staleConflicts(layout, head, op("layer-2"))).toHaveLength(1);
  });
});

describe("the agent can still register its tools", () => {
  test("no op's JSON schema has `items: false`, which the Anthropic SDK's strict-schema transform rejects", async () => {
    const { z } = await import("zod");
    const { ChangeOpSchema } = await import("../../src/layout/change.ts");
    expect(JSON.stringify(z.toJSONSchema(ChangeOpSchema))).not.toContain('"items":false');
  });
});
