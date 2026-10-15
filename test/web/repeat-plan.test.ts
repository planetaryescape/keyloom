import { describe, expect, test } from "bun:test";
import type { Binding } from "../../src/layout/schema.ts";
import { planRepeat, repeatSummary } from "../../src/web/editor/repeat-plan.ts";
import { tiny } from "../helpers/tiny.ts";

const key = (code: string): Binding => ({ kind: "key", code });
const hold = (tap: string, mods: "LALT"[]): Binding => ({ kind: "holdTap", tap: { code: tap }, hold: { mods }, profileId: "p" });

describe("planRepeat", () => {
  const layout = tiny();
  const last = { layerId: "base", position: 0, before: key("A"), after: hold("A", ["LALT"]) };

  test("gives each selected key the hold with its own letter, as one op per key that changes", () => {
    const plan = planRepeat(layout, "base", [3, 1], last);
    expect(plan.rows.map((r) => r.position)).toEqual([1, 3]);
    expect(plan.ops).toEqual([
      { op: "setBinding", at: { layerId: "base", position: 1 }, binding: hold("B", ["LALT"]) },
      { op: "setBinding", at: { layerId: "base", position: 3 }, binding: hold("D", ["LALT"]) },
    ]);
  });

  test("a key with nothing of its own to keep is skipped with its reason, and makes no op", () => {
    const plan = planRepeat(layout, "base", [1, 2], last);
    expect(plan.rows[1]).toEqual({ position: 2, kind: "skip", reason: expect.stringContaining("no key of its own") });
    expect(plan.ops).toHaveLength(1);
  });

  test("a key that already matches is reported and left out of the ops", () => {
    const withHold = tiny({ layers: [{ id: "base", name: "Base", bindings: [key("A"), hold("B", ["LALT"]), key("C"), key("D")] }, ...tiny().layers.slice(1)] });
    const plan = planRepeat(withHold, "base", [1, 3], last);
    expect(plan.rows[0]).toEqual({ position: 1, kind: "same" });
    expect(plan.ops).toHaveLength(1);
  });

  test("an edit that changed nothing has no transform and no ops", () => {
    expect(planRepeat(layout, "base", [1], { ...last, after: last.before })).toEqual({ transform: null, rows: [], ops: [] });
  });

  test("the summary names the keys by their key numbers", () => {
    const plan = planRepeat(layout, "base", [1, 3], last);
    expect(repeatSummary(layout, "base", plan)).toBe("Base, keys 2, 4: repeated the last change");
  });
});
