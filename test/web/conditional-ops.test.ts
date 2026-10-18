import { describe, expect, test } from "bun:test";
import { applyOps } from "../../src/layout/apply-ops.ts";
import { validate } from "../../src/validation/validate.ts";
import { alsoOnWords, deleteLayerOps, draftChange, draftChoices, goingWithLayer, noNewCondition, pickerChoices, setPickerChange, turnedOnBy } from "../../src/web/layers/conditional-ops.ts";
import { tiny, tinyBoard } from "../helpers/tiny.ts";

const cond = { id: "cond-nav", ifLayerIds: ["base", "num"], thenLayerId: "nav" };
const withCond = () => tiny({ conditionalLayers: [cond] });

describe("adding a condition from a layer's menu", () => {
  test("is a draft until both layers are picked, then one upsert the validator accepts", () => {
    const layout = tiny();
    expect(draftChoices(layout, "nav", null).map((c) => c.id)).toEqual(["base", "num"]);
    expect(draftChoices(layout, "nav", "base").map((c) => c.id)).toEqual(["num"]);
    const made = draftChange(layout, "nav", ["base", "num"]);
    expect("ops" in made && made.ops).toEqual([{ op: "upsertConditionalLayer", conditionalLayer: { id: "cond-nav", ifLayerIds: ["base", "num"], thenLayerId: "nav" } }]);
    if ("ops" in made) expect(validate(tinyBoard, layout, made.ops).errors.filter((e) => e.code !== "unreachable_layer")).toEqual([]);
  });

  test("refuses a pair that already turns the layer on, and says when no pair is left", () => {
    expect(draftChange(withCond(), "nav", ["num", "base"])).toEqual({ reason: "Those two already turn it on" });
    expect(noNewCondition(withCond(), "nav")).toBe("Every pair of other layers already turns it on");
    expect(noNewCondition(tiny(), "nav")).toBeNull();
  });

  test("says why when fewer than two other layers exist", () => {
    const two = tiny({ layers: tiny().layers.slice(0, 2), combos: [] });
    expect(noNewCondition(two, "num")).toBe("It needs two other layers to wait for");
  });
});

describe("the pickers", () => {
  test("offer neither the layer the condition turns on nor the layer the other picker holds", () => {
    expect(pickerChoices(tiny(), cond, 0).map((c) => c.id)).toEqual(["base"]);
    expect(pickerChoices(tiny(), cond, 1).map((c) => c.id)).toEqual(["num"]);
  });

  test("changing one builds a single upsert and an unchanged pick builds nothing", () => {
    const layout = tiny({ layers: [...tiny().layers, { id: "fn", name: "Fn", bindings: tiny().layers[0]!.bindings }] });
    const change = setPickerChange(cond, 1, "fn");
    expect(change?.ops).toEqual([{ op: "upsertConditionalLayer", conditionalLayer: { ...cond, ifLayerIds: ["base", "fn"] } }]);
    expect(setPickerChange(cond, 1, "num")).toBeNull();
    const applied = applyOps(layout, [{ op: "upsertConditionalLayer", conditionalLayer: cond }, ...(change?.ops ?? [])]);
    expect(applied.ok && applied.layout.conditionalLayers).toEqual([{ ...cond, ifLayerIds: ["base", "fn"] }]);
  });
});

describe("deleting a layer a condition names", () => {
  test("removes the conditions before the layer, after any dropped functions", () => {
    const drop = { op: "dropFunction" as const, function: "x", reason: "r" };
    expect(deleteLayerOps(withCond(), "num", [drop])).toEqual([drop, { op: "removeConditionalLayer", conditionalLayerId: "cond-nav" }, { op: "removeLayer", layerId: "num" }]);
    expect(deleteLayerOps(withCond(), "nav", [])).toEqual([{ op: "removeConditionalLayer", conditionalLayerId: "cond-nav" }, { op: "removeLayer", layerId: "nav" }]);
    expect(deleteLayerOps(tiny(), "nav", [])).toEqual([{ op: "removeLayer", layerId: "nav" }]);
  });

  test("the dialog line names the condition by its layers", () => {
    expect(goingWithLayer(withCond(), "num")).toEqual(["Base + Numbers gives Nav"]);
    expect(goingWithLayer(withCond(), "base")).toHaveLength(1);
  });
});

describe("the strip and the tab's name", () => {
  test("the layer a condition turns on knows its two layers, and says so in a sentence", () => {
    expect(turnedOnBy(withCond(), "nav")).toEqual([{ id: "cond-nav", layerIds: ["base", "num"], names: ["Base", "Numbers"] }]);
    expect(alsoOnWords(withCond(), "nav")).toBe("also on while Base and Numbers are held");
    expect(turnedOnBy(withCond(), "num")).toEqual([]);
    expect(alsoOnWords(withCond(), "num")).toBeNull();
  });
});
