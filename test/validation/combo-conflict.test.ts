// `combo_conflict` (07#errors): two combos whose layers overlap and that use the same positions can't both fire.
import { describe, expect, test } from "bun:test";
import type { ChangeOp } from "../../src/layout/change.ts";
import type { Binding, Combo, Layout } from "../../src/layout/schema.ts";
import { comboConflict } from "../../src/validation/rules.ts";
import { validate } from "../../src/validation/validate.ts";
import { T, key, tiny, tinyBoard } from "../helpers/tiny.ts";

const combo = (over: Partial<Combo> & Pick<Combo, "id">): Combo => ({
  name: over.id, positions: [0, 1], layerIds: "all", output: key("ESCAPE"), ...over,
});
const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);

/**
 * tiny() with nav reached by a key rather than by its combo, so a test can replace the combos without making a
 * layer unreachable. Nav repeats base's functions, so no edit here loses anything.
 */
function layout(combos: Combo[], over: Partial<Layout> = {}): Layout {
  const base = tiny({ combos, ...over });
  const nav: Binding[] = [key("A"), key("B"), { kind: "layer", action: "momentary", layerId: "num" }, key("D")];
  return {
    ...base,
    layers: [
      { id: "base", name: "Base", bindings: [key("A"), key("B"), { kind: "layer", action: "momentary", layerId: "nav" }, key("D")] },
      { id: "num", name: "Numbers", bindings: [key("N1"), key("N2"), T, key("N4")] },
      { id: "nav", name: "Nav", bindings: nav },
    ],
  };
}

describe("combo_conflict: two combos that could never both fire", () => {
  const cases: Array<{ what: string; combos: [Combo, Combo]; fires: boolean }> = [
    { what: "the same positions on every layer", combos: [combo({ id: "a" }), combo({ id: "b" })], fires: true },
    { what: "the same positions in the other order", combos: [combo({ id: "a" }), combo({ id: "b", positions: [1, 0] })], fires: true },
    { what: "one combo on every layer and the other on one", combos: [combo({ id: "a" }), combo({ id: "b", layerIds: ["nav"] })], fires: true },
    { what: "layer lists that share one layer", combos: [combo({ id: "a", layerIds: ["base", "num"] }), combo({ id: "b", layerIds: ["num", "nav"] })], fires: true },
    { what: "the same layer list written in another order", combos: [combo({ id: "a", layerIds: ["base", "num"] }), combo({ id: "b", layerIds: ["num", "base"] })], fires: true },
    { what: "the same positions on layers that don't overlap", combos: [combo({ id: "a", layerIds: ["base"] }), combo({ id: "b", layerIds: ["num"] })], fires: false },
    { what: "different positions on every layer", combos: [combo({ id: "a" }), combo({ id: "b", positions: [2, 3] })], fires: false },
    { what: "a subset of positions, which is a different chord", combos: [combo({ id: "a", positions: [0, 1] }), combo({ id: "b", positions: [0, 1, 2] })], fires: false },
  ];

  for (const c of cases) {
    test(`${c.fires ? "fires" : "does not fire"}: ${c.what}`, () => {
      const issues = comboConflict(layout(c.combos));
      expect(issues.map((i) => i.code)).toEqual(c.fires ? ["combo_conflict"] : []);
      if (!c.fires) return;
      // One issue per pair, naming both combos, with the sentence the editor shows and no slot to point at.
      expect(issues[0]?.message).toContain('"a"');
      expect(issues[0]?.message).toContain('"b"');
      expect(issues[0]?.message).toContain("no slot");
      expect(issues[0]?.slots).toBeUndefined();
      expect(issues[0]?.plain).toContain('"a"');
      expect(issues[0]?.plain).toContain('"b"');
    });
  }

  test("three combos on one chord are three pairs, so three errors", () => {
    expect(comboConflict(layout([combo({ id: "a" }), combo({ id: "b" }), combo({ id: "c" })])).map((i) => i.code)).toEqual([
      "combo_conflict", "combo_conflict", "combo_conflict",
    ]);
  });

  test("a repeated position is the same set as one written without the repeat", () => {
    expect(codes(comboConflict(layout([combo({ id: "a", positions: [0, 1] }), combo({ id: "b", positions: [1, 0, 1] })])))).toEqual(["combo_conflict"]);
  });

  test("it is an error through validate, so it blocks apply, and the change that adds it owns it", () => {
    const before = layout([combo({ id: "a" })]);
    const add: ChangeOp[] = [{ op: "upsertCombo", combo: combo({ id: "b", name: "Second" }) }];
    const r = validate(tinyBoard, before, add);
    expect(r.ok).toBe(false);
    expect(codes(r.errors)).toEqual(["combo_conflict"]);
    expect(r.errors[0]?.plain).toContain("Second");
  });

  test("a pair already in the layout is not the change's doing, so it stays a warning", () => {
    const before = layout([combo({ id: "a" }), combo({ id: "b" })]);
    const r = validate(tinyBoard, before, [{ op: "renameLayer", layerId: "num", name: "Digits" }]);
    expect(r.ok).toBe(true);
    expect(codes(r.warnings)).toEqual(["combo_conflict"]);
    expect(r.warnings[0]?.message).toContain("already so before this change");
  });

  test("a layout whose combos are on different keys has no issue", () => {
    expect(comboConflict(tiny())).toEqual([]);
  });
});
