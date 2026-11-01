import { expect, test } from "bun:test";
import { automaticProposalDescription, automaticReviewErrors } from "../../src/validation/review-policy.ts";
import { preservesCompoundBehavior } from "../../src/layout/behavior-facts.ts";
import { groundedLayout } from "../helpers/grounded-review.ts";

test("macro and tap-dance definitions used only by combos cannot silently change", () => {
  const layout = groundedLayout();
  layout.macros = [{ id: "m", name: "Macro", steps: [{ op: "tap", code: "A" }] }];
  layout.tapDances = [{ id: "d", name: "Dance", tap: { kind: "macro", macroId: "m" } }];
  for (const output of [{ kind: "macro", macroId: "m" }, { kind: "tapDance", tapDanceId: "d" }] as const) {
    layout.combos = [{ id: "c", name: "Chord", positions: [1, 2], layerIds: "all", output }];
    const errors = automaticReviewErrors(layout, [{ op: "upsertMacro", macro: { ...layout.macros[0]!, steps: [{ op: "tap", code: "B" }] } }]);
    expect(errors.some((e) => e.code === "review_behavior_loss")).toBe(true);
  }
  expect(automaticReviewErrors(layout, [{ op: "upsertTapDance", tapDance: { ...layout.tapDances[0]!, tap: { kind: "key", code: "B" } } }]).some((e) => e.code === "review_behavior_loss")).toBe(true);
});

test("a missing dance definition is not preserved, while tuning its term is allowed", () => {
  const before = groundedLayout();
  const binding = { kind: "tapDance", tapDanceId: "d" } as const;
  expect(preservesCompoundBehavior(before, binding, before, binding)).toBe(false);
  before.tapDances = [{ id: "d", name: "Dance", tap: { kind: "key", code: "A" }, termMs: 200 }];
  const after = structuredClone(before);
  after.tapDances[0]!.termMs = 180;
  expect(preservesCompoundBehavior(before, binding, after, binding)).toBe(true);
  after.tapDances = [];
  expect(preservesCompoundBehavior(before, binding, after, binding)).toBe(false);
});

test("effects describe added and removed layers and combo outputs rather than inventing a diagnosis", () => {
  const before = groundedLayout();
  const removal = automaticProposalDescription(before, [{ op: "removeLayer", layerId: "factory" }]);
  expect(removal.explanation).toContain("Remove layer Factory");
  expect(removal.explanation).toContain("key C → absent");
  const added = automaticProposalDescription(before, [{ op: "addLayer", layer: { id: "new", name: "New" }, afterLayerId: "factory" }, { op: "setBinding", at: { layerId: "new", position: 0 }, binding: { kind: "key", code: "D" } }]);
  expect(added.explanation).toContain("absent → key D");
  const combo = automaticProposalDescription(before, [{ op: "upsertCombo", combo: { id: "c", name: "Chord", positions: [1, 2], layerIds: "all", output: { kind: "key", code: "B" } } }]);
  expect(combo.explanation).toContain("Combo Chord (1+2): key B");
});
