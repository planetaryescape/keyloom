// The validator's view of conditional layers (D-386): the layers exist, the third isn't one of the first two, a layer that only a
// condition reaches is reachable, and reorder and delete keep it right.
import { describe, expect, test } from "bun:test";
import type { ChangeOp } from "../../src/layout/change.ts";
import { addConditionalLayerChange, conditionProblem } from "../../src/layout/conditional-layers.ts";
import type { ConditionalLayer, Layer, Layout } from "../../src/layout/schema.ts";
import { QMK_LAYER_STATE_ANCHOR } from "../../src/validation/conditional-layer-rules.ts";
import { functionHomes, reachableLayers } from "../../src/validation/reachability.ts";
import { documentRules } from "../../src/validation/rules.ts";
import { evaluate } from "../../src/validation/validate.ts";
import { T, key, tiny, tinyBoard } from "../helpers/tiny.ts";

const layer = (id: string, bindings: Layout["layers"][number]["bindings"]): Layer => ({ id, name: id[0]!.toUpperCase() + id.slice(1), bindings });
const hold = (layerId: string) => ({ kind: "layer" as const, action: "momentary" as const, layerId });
// base holds lower and raise; adjust has no key leading to it, so only the condition can reach it.
const doc = (conditionalLayers: ConditionalLayer[] = [{ id: "tri", ifLayerIds: ["lower", "raise"], thenLayerId: "adjust" }]): Layout =>
  tiny({
    layers: [
      layer("base", [hold("lower"), hold("raise"), key("A"), key("B")]),
      layer("lower", [T, T, key("N1"), T]),
      layer("raise", [T, T, key("N2"), T]),
      layer("adjust", [T, T, key("F1"), key("F2")]),
    ],
    combos: [], macros: [], conditionalLayers,
  });
const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);
const op = (conditionalLayer: ConditionalLayer): ChangeOp => ({ op: "upsertConditionalLayer", conditionalLayer });

describe("the condition's own rules", () => {
  test("a sound condition raises nothing", () => {
    expect(documentRules(tinyBoard, doc())).toEqual([]);
  });

  test("a layer that doesn't exist is unknown_ref, for any of the three", () => {
    for (const bad of [
      { id: "c", ifLayerIds: ["lower", "nope"], thenLayerId: "adjust" },
      { id: "c", ifLayerIds: ["nope", "raise"], thenLayerId: "adjust" },
      { id: "c", ifLayerIds: ["lower", "raise"], thenLayerId: "nope" },
    ]) {
      expect(codes(documentRules(tinyBoard, doc([bad])))).toContain("unknown_ref");
    }
  });

  test("the layer it turns on can't be one it waits for, and it can't wait for the same layer twice", () => {
    expect(codes(documentRules(tinyBoard, doc([{ id: "c", ifLayerIds: ["lower", "raise"], thenLayerId: "lower" }])))).toContain("conditional_layer_invalid");
    expect(codes(documentRules(tinyBoard, doc([{ id: "c", ifLayerIds: ["lower", "raise"], thenLayerId: "raise" }])))).toContain("conditional_layer_invalid");
    expect(codes(documentRules(tinyBoard, doc([{ id: "c", ifLayerIds: ["lower", "lower"], thenLayerId: "adjust" }])))).toContain("conditional_layer_invalid");
  });

  test("a change that adds such a condition is refused with a sentence for people", () => {
    const r = evaluate(tinyBoard, doc([]), [op({ id: "c", ifLayerIds: ["lower", "raise"], thenLayerId: "raise" })]).result;
    expect(r.ok).toBe(false);
    expect(r.errors.find((e) => e.code === "conditional_layer_invalid")?.plain).toBe('"Lower + Raise gives Raise" can\'t work: the layer it turns on is one of the two it waits for.');
  });

  test("two conditions with one id are a schema error", () => {
    const same = { id: "c", ifLayerIds: ["lower", "raise"], thenLayerId: "adjust" };
    expect(codes(documentRules(tinyBoard, doc([same, same])))).toContain("schema");
  });

  test("QMK kept code that already defines layer_state_set_user blocks a condition beside it", () => {
    const kept = { ...doc(), passthrough: [{ firmware: "qmk" as const, file: "keymap.c", anchor: QMK_LAYER_STATE_ANCHOR, source: "layer_state_t layer_state_set_user(layer_state_t s) { return s; }", refersToLayerIndices: false }] };
    expect(codes(documentRules(tinyBoard, kept))).toContain("conditional_layer_blocked");
    expect(codes(documentRules(tinyBoard, { ...kept, conditionalLayers: [] }))).not.toContain("conditional_layer_blocked");
  });

  test("conditionProblem and addConditionalLayerChange agree, and a repeat of a condition is not added twice", () => {
    const l = doc([]);
    expect(conditionProblem(l, { ifLayerIds: ["lower", "raise"], thenLayerId: "adjust" })).toBeNull();
    expect(addConditionalLayerChange(l, ["lower", "raise"], "raise")).toBeNull();
    const added = addConditionalLayerChange(l, ["lower", "raise"], "adjust");
    expect(added?.id).toBe("cond-adjust");
    const r = evaluate(tinyBoard, l, added!.ops).result;
    expect(r.ok).toBe(true);
    const once = { ...l, conditionalLayers: [{ id: "cond-adjust", ifLayerIds: ["lower", "raise"] as string[], thenLayerId: "adjust" }] };
    expect(addConditionalLayerChange(once, ["raise", "lower"], "adjust")).toBeNull();
  });
});

describe("reachability through a condition", () => {
  test("a layer only a condition reaches is reachable, and its keys count as functions", () => {
    expect(reachableLayers(doc()).has("adjust")).toBe(true);
    expect(functionHomes(doc()).has("key:F1")).toBe(true);
    expect(codes(documentRules(tinyBoard, doc()))).not.toContain("layer_unreachable");
  });

  test("without the condition the same layer is unreachable", () => {
    expect(reachableLayers(doc([])).has("adjust")).toBe(false);
    expect(codes(documentRules(tinyBoard, doc([])))).toContain("layer_unreachable");
  });

  test("a condition whose layers can't both be reached doesn't make its layer reachable", () => {
    const l = doc();
    const cut = { ...l, layers: l.layers.map((x) => (x.id === "base" ? { ...x, bindings: [hold("lower"), T, key("A"), key("B")] } : x)) };
    expect(reachableLayers(cut).has("adjust")).toBe(false);
  });

  test("a layer reached through a condition can itself lead to more", () => {
    const l = doc();
    const chained = { ...l, layers: [...l.layers.map((x) => (x.id === "adjust" ? { ...x, bindings: [hold("deep"), T, T, T] } : x)), layer("deep", [T, T, key("Z"), T])] };
    expect(reachableLayers(chained).has("deep")).toBe(true);
  });

  test("removing the condition is refused when it would strand a layer that was reachable", () => {
    const r = evaluate(tinyBoard, doc(), [{ op: "removeConditionalLayer", conditionalLayerId: "tri" }]).result;
    expect(r.ok).toBe(false);
    expect(codes(r.errors)).toEqual(expect.arrayContaining(["layer_unreachable", "function_lost"]));
  });

  test("removing it is fine when the lost keys are dropped on purpose", () => {
    const drops: ChangeOp[] = ["key:F1", "key:F2"].map((f) => ({ op: "dropFunction", function: f, reason: "not used" }));
    const r = evaluate(tinyBoard, doc(), [{ op: "removeConditionalLayer", conditionalLayerId: "tri" }, ...drops]).result;
    expect(codes(r.errors)).not.toContain("function_lost");
  });
});

describe("reorder and delete", () => {
  test("moving any layer leaves the condition valid, because it names ids", () => {
    const r = evaluate(tinyBoard, doc(), [{ op: "moveLayer", layerId: "adjust", afterLayerId: "base" }]);
    expect(r.result.ok).toBe(true);
    expect(r.after?.conditionalLayers).toEqual(doc().conditionalLayers);
    expect(r.after?.layers.map((l) => l.id)).toEqual(["base", "adjust", "lower", "raise"]);
  });

  test("deleting a layer the condition names is refused until the condition goes, in any of the three roles", () => {
    for (const layerId of ["lower", "raise", "adjust"]) {
      const refused = evaluate(tinyBoard, doc(), [{ op: "removeLayer", layerId }]).result;
      expect(refused.ok).toBe(false);
      expect(codes(refused.errors)).toContain("unknown_ref");
    }
  });

  test("deleting the third layer together with its condition is accepted once its keys are dropped", () => {
    const drops: ChangeOp[] = ["key:F1", "key:F2"].map((f) => ({ op: "dropFunction", function: f, reason: "going" }));
    const r = evaluate(tinyBoard, doc(), [{ op: "removeConditionalLayer", conditionalLayerId: "tri" }, { op: "removeLayer", layerId: "adjust" }, ...drops]).result;
    expect(r.errors).toEqual([]);
  });
});
