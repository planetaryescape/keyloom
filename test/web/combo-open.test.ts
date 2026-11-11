// Open combo from the delete-layer dialog never throws away a combo card's edits (#290 review).
import { expect, test } from "bun:test";
import { draftFromCombo, openComboFromElsewhere } from "../../src/web/combos/ComboPane.tsx";
import type { Combo } from "../../src/layout/schema.ts";
import { key } from "../helpers/tiny.ts";

const combos: Combo[] = [
  { id: "c1", name: "Go", positions: [0, 1], layerIds: "all", output: key("A") },
  { id: "c2", name: "Quote", positions: [1, 2], layerIds: "all", output: key("Q") },
];

test("with no card open, or an unchanged one, the combo opens", () => {
  expect(openComboFromElsewhere(null, combos, "c1")).toBe("open");
  expect(openComboFromElsewhere(draftFromCombo(combos[1]!), combos, "c1")).toBe("open");
  expect(openComboFromElsewhere(draftFromCombo(combos[0]!), combos, "c1")).toBe("open");
});

test("a changed card shows itself for the same combo and blocks another one", () => {
  const edited = { ...draftFromCombo(combos[0]!), name: "Go now" };
  expect(openComboFromElsewhere(edited, combos, "c1")).toBe("show_draft");
  expect(openComboFromElsewhere(edited, combos, "c2")).toBe("blocked");
});

test("a combo still being made counts as changed", () => {
  const made = { id: "c9", isNew: true, name: "", positions: [0, 2], layerIds: "all" as const, output: null, timeoutMs: undefined };
  expect(openComboFromElsewhere(made, combos, "c1")).toBe("blocked");
});
