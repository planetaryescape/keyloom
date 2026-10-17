import { describe, expect, test } from "bun:test";
import { applyOps } from "../../src/layout/apply-ops.ts";
import { validate } from "../../src/validation/validate.ts";
import { deleteLayerOps, goingWithLayer, newConditionChange, pickerChoices, setPickerChange, stripLinks } from "../../src/web/layers/conditional-ops.ts";
import { tiny, tinyBoard } from "../helpers/tiny.ts";

const cond = { id: "cond-nav", ifLayerIds: ["base", "num"], thenLayerId: "nav" };
const withCond = () => tiny({ conditionalLayers: [cond] });

describe("adding a condition from a layer's menu", () => {
  test("defaults to the first two other layers and the validator accepts it", () => {
    const layout = tiny();
    const made = newConditionChange(layout, "nav");
    expect("ops" in made && made.ops).toEqual([{ op: "upsertConditionalLayer", conditionalLayer: { id: "cond-nav", ifLayerIds: ["base", "num"], thenLayerId: "nav" } }]);
    if ("ops" in made) expect(validate(tinyBoard, layout, made.ops).errors.filter((e) => e.code !== "unreachable_layer")).toEqual([]);
  });

  test("never picks the layer itself, and says so when every pair is already used", () => {
    expect(newConditionChange(withCond(), "nav")).toEqual({ reason: "Every pair of other layers already turns this one on" });
    const four = tiny({ layers: [...tiny().layers, { id: "fn", name: "Fn", bindings: tiny().layers[0]!.bindings }], conditionalLayers: [cond] });
    const second = newConditionChange(four, "nav");
    expect("ops" in second && second.ops[0]).toEqual({ op: "upsertConditionalLayer", conditionalLayer: { id: "cond-nav-2", ifLayerIds: ["base", "fn"], thenLayerId: "nav" } });
  });

  test("says why when fewer than two other layers exist", () => {
    const two = tiny({ layers: tiny().layers.slice(0, 2), combos: [] });
    expect(newConditionChange(two, "num")).toEqual({ reason: "Needs two other layers" });
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

describe("the strip link", () => {
  test("sits on the layer the condition turns on, in short labels", () => {
    const links = stripLinks(withCond(), "nav");
    expect(links).toHaveLength(1);
    expect(links[0]?.text).toMatch(/ \+ /);
    expect(links[0]?.label).toBe("Also on when Base and Numbers are held. Open the condition.");
    expect(stripLinks(withCond(), "num")).toEqual([]);
  });
});
