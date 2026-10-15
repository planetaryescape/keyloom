import { describe, expect, test } from "bun:test";
import { applyOps } from "../../src/layout/apply-ops.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { LayoutSchema } from "../../src/layout/schema.ts";
import { T, key, tiny } from "../helpers/tiny.ts";

const run = (ops: ChangeOp[], layout = tiny()) => {
  const r = applyOps(layout, ops);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.layout;
};
const failure = (ops: ChangeOp[], layout = tiny()) => {
  const r = applyOps(layout, ops);
  if (r.ok) throw new Error("expected the ops to fail");
  return r.error;
};
const at = (layerId: string, position: number) => ({ layerId, position });

describe("applyOps", () => {
  test("setBinding replaces one slot", () => {
    const out = run([{ op: "setBinding", at: at("num", 0), binding: key("F1") }]);
    expect(out.layers[1]?.bindings[0]).toEqual(key("F1"));
    expect(out.layers[1]?.bindings[1]).toEqual(key("N2"));
  });

  test("moveBinding leaves transparent on a non-base layer and none on the base layer", () => {
    const upper = run([{ op: "moveBinding", from: at("num", 0), to: at("num", 2) }]);
    expect(upper.layers[1]?.bindings).toEqual([T, key("N2"), key("N1"), key("N4")]);
    const base = run([{ op: "moveBinding", from: at("base", 0), to: at("base", 1) }]);
    expect(base.layers[0]?.bindings[0]).toEqual({ kind: "none" });
    expect(base.layers[0]?.bindings[1]).toEqual(key("A")); // B is displaced
  });

  test("moveBinding onto itself changes nothing", () => {
    expect(run([{ op: "moveBinding", from: at("base", 0), to: at("base", 0) }])).toEqual(tiny());
  });

  test("swapBindings works across layers and onto itself", () => {
    const out = run([{ op: "swapBindings", a: at("base", 0), b: at("num", 3) }]);
    expect(out.layers[0]?.bindings[0]).toEqual(key("N4"));
    expect(out.layers[1]?.bindings[3]).toEqual(key("A"));
    expect(run([{ op: "swapBindings", a: at("base", 0), b: at("base", 0) }])).toEqual(tiny());
  });

  test("addLayer fills with transparent and goes after the named layer", () => {
    const out = run([{ op: "addLayer", layer: { id: "fn", name: "Fn" }, afterLayerId: "base" }]);
    expect(out.layers.map((l) => l.id)).toEqual(["base", "fn", "num", "nav"]);
    expect(out.layers[1]?.bindings).toEqual([T, T, T, T]);
    expect(run([{ op: "addLayer", layer: { id: "fn", name: "Fn" }, afterLayerId: "nav" }]).layers.map((l) => l.id)).toEqual(["base", "num", "nav", "fn"]);
  });

  test("removeLayer and renameLayer", () => {
    expect(run([{ op: "removeLayer", layerId: "num" }]).layers.map((l) => l.id)).toEqual(["base", "nav"]);
    expect(run([{ op: "renameLayer", layerId: "num", name: "Digits" }]).layers[1]?.name).toBe("Digits");
  });

  test("macros, combos and profiles upsert by id and remove", () => {
    const macro = { id: "m1", name: "Renamed", steps: [{ op: "tap" as const, code: "B" }] };
    expect(run([{ op: "upsertMacro", macro }]).macros).toEqual([macro]);
    expect(run([{ op: "upsertMacro", macro: { ...macro, id: "m2" } }]).macros.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(run([{ op: "removeMacro", macroId: "m1" }]).macros).toEqual([]);

    const combo = { id: "c1", name: "C", positions: [0, 1], layerIds: "all" as const, output: key("ESCAPE") };
    const withCombo = run([{ op: "upsertCombo", combo }]);
    expect(withCombo.combos.at(-1)).toEqual(combo);
    expect(run([{ op: "upsertCombo", combo: { ...combo, name: "C2" } }], withCombo).combos.at(-1)?.name).toBe("C2");
    expect(run([{ op: "removeCombo", comboId: "c1" }], withCombo).combos).toEqual(tiny().combos);

    const profile = { id: "p", name: "P2", firmware: "qmk" as const, options: { x: 1 } };
    expect(run([{ op: "upsertHoldTapProfile", profile }]).holdTapProfiles).toEqual([profile]);
  });

  test("setFirmwareSetting replaces by firmware and key", () => {
    const one = run([{ op: "setFirmwareSetting", setting: { firmware: "qmk", key: "TAPPING_TERM", value: 200 } }]);
    const two = run([{ op: "setFirmwareSetting", setting: { firmware: "qmk", key: "TAPPING_TERM", value: 180 } }], one);
    expect(two.settings).toEqual([{ firmware: "qmk", key: "TAPPING_TERM", value: 180 }]);
  });

  test("dropFunction leaves the document alone", () => {
    expect(run([{ op: "dropFunction", function: "key:A", reason: "unused" }])).toEqual(tiny());
  });

  test("ops apply in order", () => {
    const out = run([
      { op: "setBinding", at: at("base", 0), binding: key("X") },
      { op: "swapBindings", a: at("base", 0), b: at("base", 1) },
    ]);
    expect(out.layers[0]?.bindings.slice(0, 2)).toEqual([key("B"), key("X")]);
  });

  test("never mutates the input, even when a later op fails", () => {
    const before = tiny();
    const snapshot = structuredClone(before);
    applyOps(before, [
      { op: "setBinding", at: at("base", 0), binding: key("Z") },
      { op: "addLayer", layer: { id: "fn", name: "Fn" }, afterLayerId: "base" },
      { op: "removeMacro", macroId: "nope" },
    ]);
    expect(before).toEqual(snapshot);
  });

  test("the output doesn't share objects with the ops", () => {
    const binding = key("F1");
    const out = run([{ op: "setBinding", at: at("base", 0), binding }]);
    expect(out.layers[0]?.bindings[0]).not.toBe(binding);
  });

  test("names what is missing, with the index of the failing op", () => {
    const set = (layerId: string, position: number): ChangeOp => ({ op: "setBinding", at: at(layerId, position), binding: key("A") });
    expect(failure([set("base", 0), set("ghost", 0)])).toMatchObject({ index: 1, code: "unknown_ref" });
    expect(failure([set("base", 4)])).toMatchObject({ code: "unknown_ref" });
    expect(failure([{ op: "moveBinding", from: at("base", 0), to: at("base", 9) }])).toMatchObject({ code: "unknown_ref" });
    expect(failure([{ op: "removeLayer", layerId: "ghost" }])).toMatchObject({ code: "unknown_ref" });
    expect(failure([{ op: "renameLayer", layerId: "ghost", name: "x" }])).toMatchObject({ code: "unknown_ref" });
    expect(failure([{ op: "addLayer", layer: { id: "fn", name: "Fn" }, afterLayerId: "ghost" }])).toMatchObject({ code: "unknown_ref" });
    expect(failure([{ op: "removeCombo", comboId: "ghost" }])).toMatchObject({ code: "unknown_ref" });
    expect(failure([{ op: "addLayer", layer: { id: "num", name: "Dup" }, afterLayerId: "base" }])).toMatchObject({ code: "schema" });
  });

  test("a removed layer's references are left for the validator", () => {
    const out = run([{ op: "removeLayer", layerId: "num" }]);
    expect(out.layers[0]?.bindings[2]).toEqual({ kind: "layer", action: "momentary", layerId: "num" });
    expect(LayoutSchema.safeParse(out).success).toBe(true);
  });
});
