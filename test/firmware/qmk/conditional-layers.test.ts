// Conditional layers on QMK (D-387): `update_tri_layer_state` in layer_state_set_user and the Tri Layer feature are read into the
// model, written back with the layers' current numbers, and left as kept code when they do more than that.
import { describe, expect, test } from "bun:test";
import { loadBoardDir } from "../../../src/boards/load.ts";
import { generateQmkSource } from "../../../src/firmware/qmk/generate.ts";
import { importQmkSource } from "../../../src/firmware/qmk/import.ts";
import { LAYER_STATE_ANCHOR } from "../../../src/firmware/qmk/keymap-c.ts";
import { applyOps } from "../../../src/layout/apply-ops.ts";
import { QMK_LAYER_STATE_ANCHOR } from "../../../src/validation/conditional-layer-rules.ts";
import type { Layout } from "../../../src/layout/schema.ts";
import { templateCopy } from "../../helpers/board-recipes.ts";

const board = (await loadBoardDir(await templateCopy("qmk"))).definition;

const LAYERS = `enum layers { _BASE, _LOWER, _RAISE, _ADJUST };`;
const layer = (name: string, a: string, b: string, c = "KC_NO", d = "KC_NO") => `    [${name}] = LAYOUT(${a}, ${b}, ${c}, ${d}),`;
const keymap = (head: string, tail = "", keys: [string, string] = ["MO(_LOWER)", "MO(_RAISE)"]) =>
  `#include QMK_KEYBOARD_H\n${LAYERS}\n${head}\nconst uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {\n${[
    layer("_BASE", ...keys), layer("_LOWER", "KC_A", "KC_B"), layer("_RAISE", "KC_C", "KC_D"), layer("_ADJUST", "KC_E", "KC_F"),
  ].join("\n")}\n};\n${tail}`;

const FN = (body: string) => `layer_state_t layer_state_set_user(layer_state_t state) {\n${body}\n}\n`;
const bring = (keymapC: string, rulesMk?: string, configH?: string) => importQmkSource({ name: "t", keymapC, ...(rulesMk === undefined ? {} : { rulesMk }), ...(configH === undefined ? {} : { configH }) }, board);
const gen = (layout: Layout) => generateQmkSource({ layout, board, revisionId: "rev_T" });
const keymapC = (layout: Layout) => gen(layout).files.find((f) => f.path === "keymap.c")?.content ?? "";

describe("layer_state_set_user with update_tri_layer_state", () => {
  test("a function that is only the call becomes a condition on layer ids, and is not kept", async () => {
    const { layout, report } = await bring(keymap("", FN("  return update_tri_layer_state(state, _LOWER, _RAISE, _ADJUST);")));
    expect(layout.conditionalLayers).toEqual([{ id: "cond-layer-3", ifLayerIds: ["layer-1", "layer-2"], thenLayerId: "layer-3" }]);
    expect(layout.passthrough.some((p) => p.anchor === LAYER_STATE_ANCHOR)).toBe(false);
    expect(report.warnings).toEqual(expect.not.arrayContaining([expect.stringContaining("layer_state_set_user")]));
  });

  test("the assignment form, numbers, and a chain of two are all read, in order", async () => {
    const { layout } = await bring(keymap("", FN("  state = update_tri_layer_state(state, 1, 2, 3);\n  state = update_tri_layer_state(state, _BASE, _RAISE, _ADJUST);\n  return state;")));
    expect(layout.conditionalLayers.map((c) => [c.ifLayerIds, c.thenLayerId])).toEqual([
      [["layer-1", "layer-2"], "layer-3"],
      [["layer-0", "layer-2"], "layer-3"],
    ]);
  });

  test("is written as a function over the layers' current numbers, and import, generate, import is stable", async () => {
    const first = (await bring(keymap("", FN("  return update_tri_layer_state(state, _LOWER, _RAISE, _ADJUST);")))).layout;
    const text = keymapC(first);
    expect(text).toContain("layer_state_t layer_state_set_user(layer_state_t state) {\n  state = update_tri_layer_state(state, 1, 2, 3);\n  return state;\n}");
    const again = (await bring(text)).layout;
    expect(again.conditionalLayers).toEqual(first.conditionalLayers);
    expect(keymapC(again).match(/layer_state_t layer_state_set_user[\s\S]*?\n}/)?.[0]).toBe(text.match(/layer_state_t layer_state_set_user[\s\S]*?\n}/)?.[0]);
  });

  test("a reorder renumbers it: moving the adjust layer to the front of the others changes the numbers, not the condition", async () => {
    const { layout } = await bring(keymap("", FN("  return update_tri_layer_state(state, _LOWER, _RAISE, _ADJUST);")));
    const moved = applyOps(layout, [{ op: "moveLayer", layerId: "layer-3", afterLayerId: "layer-0" }]);
    if (!moved.ok) throw new Error(moved.error.message);
    // adjust is now 1, lower 2, raise 3.
    expect(keymapC(moved.layout)).toContain("update_tri_layer_state(state, 2, 3, 1)");
    expect(moved.layout.conditionalLayers).toEqual(layout.conditionalLayers);
  });

  test("a function that does anything else stays kept code, with its layer numbers recorded, and no condition is made", async () => {
    const other = FN("  state = update_tri_layer_state(state, 1, 2, 3);\n  if (layer_state_cmp(state, 3)) { tap_code(KC_A); }\n  return state;");
    const { layout } = await bring(keymap("", other));
    expect(layout.conditionalLayers).toEqual([]);
    const kept = layout.passthrough.find((p) => p.anchor === LAYER_STATE_ANCHOR);
    expect(kept?.source).toContain("update_tri_layer_state");
    expect(kept?.layerRefs?.length).toBeGreaterThan(0);
  });

  test("a condition whose layers the function names the same twice stays kept", async () => {
    const { layout, report } = await bring(keymap("", FN("  return update_tri_layer_state(state, _LOWER, _LOWER, _ADJUST);")));
    expect(layout.conditionalLayers).toEqual([]);
    expect(layout.passthrough.some((p) => p.anchor === LAYER_STATE_ANCHOR)).toBe(true);
    expect(report.warnings.some((w) => w.includes("layer_state_set_user kept as written"))).toBe(true);
  });

  test("generating a condition beside kept layer_state_set_user is refused instead of defining it twice", async () => {
    const kept = (await bring(keymap("", FN("  if (layer_state_cmp(state, 1)) {}\n  return state;")))).layout;
    expect(() => gen({ ...kept, conditionalLayers: [{ id: "c", ifLayerIds: ["layer-1", "layer-2"], thenLayerId: "layer-3" }] })).toThrow("keeps its own layer_state_set_user");
  });

  test("the validator's anchor is the importer's", () => {
    expect(QMK_LAYER_STATE_ANCHOR).toBe(LAYER_STATE_ANCHOR);
  });
});

describe("the Tri Layer feature", () => {
  const RULES = "TRI_LAYER_ENABLE = yes\n";
  const CONFIG = "#define TRI_LAYER_LOWER_LAYER 1\n#define TRI_LAYER_UPPER_LAYER 2\n#define TRI_LAYER_ADJUST_LAYER 3\n";
  const keys: [string, string] = ["TL_LOWR", "TL_UPPR"];

  test("TL_LOWR and TL_UPPR with the defines become momentary layer keys and a condition; the defines are not kept as settings", async () => {
    const { layout, report } = await bring(keymap("", "", keys), RULES, CONFIG);
    expect(layout.layers[0]?.bindings.slice(0, 2)).toEqual([
      { kind: "layer", action: "momentary", layerId: "layer-1" },
      { kind: "layer", action: "momentary", layerId: "layer-2" },
    ]);
    expect(layout.conditionalLayers).toEqual([{ id: "cond-layer-3", ifLayerIds: ["layer-1", "layer-2"], thenLayerId: "layer-3" }]);
    expect(layout.settings.map((s) => s.key)).toEqual([]);
    expect(report.warnings.some((w) => w.includes("TL_LOWR and TL_UPPR were read as keys"))).toBe(true);
  });

  test("without the defines it uses QMK's defaults 1, 2 and 3", async () => {
    const { layout } = await bring(keymap("", "", keys), RULES);
    expect(layout.conditionalLayers.map((c) => [c.ifLayerIds, c.thenLayerId])).toEqual([[["layer-1", "layer-2"], "layer-3"]]);
  });

  test("the same condition from both sources is one condition", async () => {
    const { layout } = await bring(keymap("", "", keys) + FN("  return update_tri_layer_state(state, _LOWER, _RAISE, _ADJUST);"), RULES, CONFIG);
    expect(layout.conditionalLayers).toHaveLength(1);
  });

  test("the feature on with no TL key in the keymap models nothing: VIA builds turn it on without using it", async () => {
    const { layout } = await bring(keymap(""), RULES, CONFIG);
    expect(layout.conditionalLayers).toEqual([]);
    expect(layout.settings.map((s) => s.key)).toContain("TRI_LAYER_LOWER_LAYER");
  });

  test("defines that name layers that don't exist keep the keys as written, with a warning", async () => {
    const { layout, report } = await bring(keymap("", "", keys), RULES, "#define TRI_LAYER_ADJUST_LAYER 9\n");
    expect(layout.conditionalLayers).toEqual([]);
    expect(layout.layers[0]?.bindings[0]?.kind).toBe("native");
    expect(report.warnings.some((w) => w.includes("Tri Layer feature is on"))).toBe(true);
  });
});
