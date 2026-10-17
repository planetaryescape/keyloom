// BK's real boards, reordered: the kept code and kept keys still name the layers they named before (D-360).
import { describe, expect, test } from "bun:test";
import { applyOps } from "../../src/layout/apply-ops.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { generateQmkSource } from "../../src/firmware/qmk/generate.ts";
import { importZmkSource } from "../../src/firmware/zmk/import.ts";
import { generateZmkSource } from "../../src/firmware/zmk/generate.ts";
import { validate } from "../../src/validation/validate.ts";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";
import { TEMPLATE_FIXTURE, glove80 } from "../helpers/zmk.ts";

const moved = (layout: Layout, ops: ChangeOp[]): Layout => {
  const r = applyOps(layout, ops);
  if (!r.ok) throw new Error(r.error.message);
  return r.layout;
};
const text = (files: { path: string; content: string }[], path: string) => files.find((f) => f.path === path)?.content ?? "";

describe("the Moonlander (Oryx C)", () => {
  const load = async () => {
    const board = await moonlander();
    return { board: board.definition, layout: (await importOryxSource(FIXTURE_DIR, board.definition)).layout };
  };
  // layer-5, which the dual-function key LT(5, KC_4) holds, goes from the end to just after layer-1.
  const move: ChangeOp[] = [{ op: "moveLayer", layerId: "layer-5", afterLayerId: "layer-1" }];

  test("Move left is allowed, and the generated code names the layer at its new number", async () => {
    const { board, layout } = await load();
    const result = validate(board, layout, move);
    expect(result.errors).toEqual([]);
    const after = moved(layout, move);
    expect(after.layers.map((l) => l.id)).toEqual(["layer-0", "layer-1", "layer-5", "layer-2", "layer-3", "layer-4"]);

    const before = text(generateQmkSource({ layout, board, revisionId: "rev" }).files, "keymap.c");
    const now = text(generateQmkSource({ layout: after, board, revisionId: "rev" }).files, "keymap.c");
    expect(before).toContain("#define DUAL_FUNC_0 LT(5, KC_4)");
    expect(before).toContain("layer_move(5)");
    expect(now).toContain("#define DUAL_FUNC_0 LT(2, KC_4)");
    expect(now).not.toContain("layer_move(5)");
    expect(now.match(/layer_move\(2\)/g)?.length).toBe(2);
    // The modelled keys follow by id, as they always did: TG(4) toggled layer-4, which is now at 5.
    expect(now).toContain("TG(5)");
  });

  test("the layer colours follow their layers", async () => {
    const { board, layout } = await load();
    const after = moved(layout, move);
    const now = text(generateQmkSource({ layout: after, board, revisionId: "rev" }).files, "keymap.c");
    const row = (src: string, layerNumber: number) => src.split("\n").find((l) => l.includes(`[${layerNumber}] = {`))?.replace(/^\s*\[\d+\]/, "");
    const was = text(generateQmkSource({ layout, board, revisionId: "rev" }).files, "keymap.c");
    expect(row(now, 2)).toBe(row(was, 5));
  });

  test("deleting the layer the dual-function key holds is refused, naming the code", async () => {
    const { board, layout } = await load();
    const result = validate(board, layout, [{ op: "removeLayer", layerId: "layer-5" }]);
    const refusal = result.errors.find((e) => e.code === "passthrough_layer_index");
    expect(refusal?.message).toContain("keymap.c define:DUAL_FUNC_0 line 1 (#define DUAL_FUNC_0 LT(5, KC_4))");
    expect(refusal?.message).toContain("process_record_user:DUAL_FUNC_0 line 10 (layer_move(5);)");
  });
});

describe("the Glove80 (MoErgo's keymap)", () => {
  const load = async () => {
    const board = await glove80();
    return { board: board.definition, geometry: board.geometry, layout: (await importZmkSource(TEMPLATE_FIXTURE, board.definition)).layout };
  };
  const move: ChangeOp[] = [{ op: "moveLayer", layerId: "factory-test-layer", afterLayerId: "default-layer" }];

  test("Move left is allowed; the defines, the kept behaviours and the keys all follow the layer", async () => {
    const { board, geometry, layout } = await load();
    expect(validate(board, layout, move).errors).toEqual([]);
    const after = moved(layout, move);
    const src = (l: Layout) => generateZmkSource({ layout: l, board, geometry, revisionId: "rev" }).files.map((f) => f.content).join("\n");
    const was = src(layout);
    const now = src(after);
    expect(was).toContain("#define FACTORY_TEST 3");
    expect(now).toContain("#define FACTORY_TEST 1");
    expect(now).toContain("#define LOWER 2");
    expect(now).toContain("#define MAGIC 3");
    // Keys are written with the define's name, so they read what the keymap defines.
    expect(now).toContain("&to FACTORY_TEST");
    expect(now).toContain("&mo LOWER");
    // The kept tap dance and hold-tap read the same defines.
    expect(now).toContain("bindings = <&mo LOWER>, <&to LOWER>;");
    expect(now).toContain("&magic MAGIC 0");
  });

  test("deleting a layer the keymap's code names is refused", async () => {
    const { board, layout } = await load();
    const result = validate(board, layout, [{ op: "removeLayer", layerId: "lower-layer" }]);
    expect(result.errors.map((e) => e.code)).toContain("passthrough_layer_index");
  });
});
