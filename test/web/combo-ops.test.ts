import { describe, expect, test } from "bun:test";
import { applyOps } from "../../src/layout/apply-ops.ts";
import {
  comboNameFor, comboProblem, combosOn, conflictingCombo, layersFromChoice, newCombo, newComboId, removeComboOps, upsertComboOps,
} from "../../src/web/combos/combo-ops.ts";
import { validate } from "../../src/validation/validate.ts";
import { key, tiny, tinyBoard } from "../helpers/tiny.ts";

const base = () => tiny({ combos: [] });

describe("making a combo from a selection", () => {
  test("two keys and Esc make an all-layers combo named from its output", () => {
    const layout = base();
    const combo = newCombo(layout, [2, 1], key("ESCAPE"));
    expect(combo).toEqual({ id: "combo-1", name: "Esc combo", positions: [1, 2], layerIds: "all", output: key("ESCAPE") });
    const result = validate(tinyBoard, layout, upsertComboOps(combo));
    expect(result.ok).toBe(true);
    const applied = applyOps(layout, upsertComboOps(combo));
    expect(applied.ok && applied.layout.combos).toEqual([combo]);
  });

  test("names and ids stay unique when the same output is used again", () => {
    const first = newCombo(base(), [0, 1], key("ESCAPE"));
    const layout = tiny({ combos: [first] });
    expect(newComboId(layout)).toBe("combo-2");
    expect(comboNameFor(layout, key("ESCAPE"))).toBe("Esc combo 2");
    // Editing a combo doesn't count its own name as taken.
    expect(comboNameFor(layout, key("ESCAPE"), first.id)).toBe("Esc combo");
  });

  test("an id is never reused after a combo in the middle is removed", () => {
    const layout = tiny({
      combos: [
        { id: "combo-2", name: "A combo", positions: [0, 1], layerIds: "all", output: key("A") },
        { id: "combo-3", name: "B combo", positions: [1, 2], layerIds: "all", output: key("B") },
      ],
    });
    expect(newComboId(layout)).toBe("combo-4");
  });

  test("fewer than two keys is a problem, and so is a repeat of the same keys on the same layers", () => {
    const first = newCombo(base(), [0, 1], key("ESCAPE"));
    const layout = tiny({ combos: [first] });
    expect(comboProblem(layout, { ...first, id: "combo-9", positions: [3] }, true)).toBe("A combo needs at least two keys.");
    expect(comboProblem(layout, { ...first, id: "combo-9", name: "Other", output: key("Q") }, true)).toBe("These keys already make Esc combo on the same layers.");
    // The same keys on layers that don't overlap are two different combos.
    const limited = tiny({ combos: [{ ...first, layerIds: ["num"] }] });
    expect(conflictingCombo(limited, [0, 1], ["nav"])).toBeUndefined();
    expect(conflictingCombo(limited, [1, 0], ["num", "nav"])?.id).toBe(first.id);
    // Editing a combo isn't a clash with itself.
    expect(comboProblem(layout, first, false)).toBeNull();
  });

  test("a choice of every layer is stored as all, and none is refused", () => {
    expect(layersFromChoice(base(), ["base", "num", "nav"])).toBe("all");
    expect(layersFromChoice(base(), ["nav", "base"])).toEqual(["base", "nav"]);
    expect(layersFromChoice(base(), [])).toBeNull();
    expect(layersFromChoice(base(), ["gone"])).toBeNull();
  });

  test("a combo on a layer that does not exist is refused by the validator", () => {
    const combo = { ...newCombo(base(), [0, 1], key("ESCAPE")), layerIds: ["gone"] };
    expect(validate(tinyBoard, base(), upsertComboOps(combo)).errors.map((e) => e.code)).toContain("unknown_ref");
  });
});

describe("editing and removing a combo", () => {
  test("upserting by id replaces the output, keys, layers and timeout, and remove deletes it", () => {
    const first = newCombo(base(), [0, 1], key("ESCAPE"));
    const layout = tiny({ combos: [first] });
    const edited = { ...first, positions: [0, 2, 3], output: key("TAB"), layerIds: ["base"], timeoutMs: 35 };
    const out = applyOps(layout, upsertComboOps(edited));
    expect(out.ok && out.layout.combos).toEqual([edited]);
    const gone = applyOps(layout, removeComboOps(first.id));
    expect(gone.ok && gone.layout.combos).toEqual([]);
    expect(applyOps(layout, removeComboOps("missing")).ok).toBe(false);
  });

  test("combosOn lists the combos that apply on a layer", () => {
    const all = newCombo(base(), [0, 1], key("A"));
    const only = { ...newCombo(base(), [1, 2], key("B")), id: "combo-2", layerIds: ["num"] };
    const layout = tiny({ combos: [all, only] });
    expect(combosOn(layout, "base").map((c) => c.id)).toEqual(["combo-1"]);
    expect(combosOn(layout, "num").map((c) => c.id)).toEqual(["combo-1", "combo-2"]);
  });
});
