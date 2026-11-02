import { expect, test } from "bun:test";
import { automaticProposalDescription, automaticReviewErrors } from "../../src/validation/review-policy.ts";
import { preservesCompoundBehavior } from "../../src/layout/behavior-facts.ts";
import { groundedLayout } from "../helpers/grounded-review.ts";
import { glove80 } from "../helpers/zmk.ts";
import { proposalChanges } from "../../src/validation/proposal-changes.ts";

const board = (await glove80()).definition;

test("macro and tap-dance definitions used only by combos cannot silently change", () => {
  const layout = groundedLayout();
  layout.macros = [{ id: "m", name: "Macro", steps: [{ op: "tap", code: "A" }] }];
  layout.tapDances = [{ id: "d", name: "Dance", tap: { kind: "macro", macroId: "m" } }];
  for (const output of [{ kind: "macro", macroId: "m" }, { kind: "tapDance", tapDanceId: "d" }] as const) {
    layout.combos = [{ id: "c", name: "Chord", positions: [1, 2], layerIds: "all", output }];
    const errors = automaticReviewErrors(layout, [{ op: "upsertMacro", macro: { ...layout.macros[0]!, steps: [{ op: "tap", code: "B" }] } }]);
    expect(errors.some((e) => e.code === "review_behavior_loss")).toBe(true);
    expect(automaticReviewErrors(layout, [{ op: "upsertMacro", macro: layout.macros[0]! }]).some((e) => e.code === "review_behavior_loss")).toBe(false);
  }
  expect(automaticReviewErrors(layout, [{ op: "upsertTapDance", tapDance: { ...layout.tapDances[0]!, tap: { kind: "key", code: "B" } } }]).some((e) => e.code === "review_behavior_loss")).toBe(true);
  expect(automaticReviewErrors(layout, [{ op: "upsertTapDance", tapDance: layout.tapDances[0]! }]).some((e) => e.code === "review_behavior_loss")).toBe(false);
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
  const removal = automaticProposalDescription(before, [{ op: "removeLayer", layerId: "factory" }], board);
  expect(removal.explanation).toContain("layer Factory removed");
  const added = automaticProposalDescription(before, [{ op: "addLayer", layer: { id: "new", name: "New" }, afterLayerId: "factory" }, { op: "setBinding", at: { layerId: "new", position: 0 }, binding: { kind: "key", code: "D" } }], board);
  expect(added.explanation).toContain("layer New added");
  const combo = automaticProposalDescription(before, [{ op: "upsertCombo", combo: { id: "c", name: "Chord", positions: [1, 2], layerIds: "all", output: { kind: "key", code: "B" } } }], board);
  expect(combo.explanation).toContain("combos changed");
});

test("profile source summary names changed timing and summarizes long position sets without serializing them", () => {
  const before = groundedLayout();
  before.holdTapProfiles = [{ id: "hold", name: "Home row", firmware: "zmk", options: { flavor: "balanced", "tapping-term-ms": 200, "hold-trigger-key-positions": [0, 1, 2] } }];
  const result = automaticProposalDescription(before, [{ op: "upsertHoldTapProfile", profile: { ...before.holdTapProfiles[0]!, options: { flavor: "tap-preferred", "tapping-term-ms": 240, "hold-trigger-key-positions": Array.from({ length: 40 }, (_, i) => i) } } }], board);
  expect(result.explanation).toContain("Tapping term, 200 ms to 240 ms");
  expect(result.explanation).toContain("Flavor, Balanced to Tap preferred");
  expect(result.explanation).toContain("hold-trigger positions added 4, 5, 6");
  expect(result.explanation).not.toContain("[0,1,2");
  expect(result.explanation).not.toContain("{\"flavor\"");
});

test("same legends do not hide settings-only changes, and unchanged profile options are omitted", () => {
  const before = groundedLayout();
  before.holdTapProfiles = [{ id: "hold", name: "Home row", firmware: "zmk", options: { flavor: "balanced", "tapping-term-ms": 200 } }];
  const changed = automaticProposalDescription(before, [{ op: "upsertHoldTapProfile", profile: { ...before.holdTapProfiles[0]!, options: { flavor: "balanced", "tapping-term-ms": 200, "quick-tap-ms": 150 } } }], board);
  expect(changed.explanation).toContain("Quick tap, Not set to 150 ms");
  expect(changed.explanation).not.toContain("Tapping term");
});

test("unknown structured options are labeled without dumping values; invalid operations remain rejected", () => {
  const before = groundedLayout();
  before.holdTapProfiles = [{ id: "hold", name: "Home row", firmware: "zmk", options: { "vendor-special": [1, 2, 3] } }];
  const result = automaticProposalDescription(before, [{ op: "upsertHoldTapProfile", profile: { ...before.holdTapProfiles[0]!, options: { "vendor-special": [1, 2, 3, 4] } } }], board);
  expect(result.explanation).toContain("Unrecognized option “vendor-special”");
  expect(result.explanation).toContain("Numbers: 1, 2, 3 to Numbers: 1, 2, 3, 4");
  const facts = proposalChanges(before, [{ op: "upsertHoldTapProfile", profile: { ...before.holdTapProfiles[0]!, options: { "vendor-special": [6, 7, 8] } } }], board);
  expect(facts.profiles[0]?.fields[0]?.currentValues).toEqual([1, 2, 3]);
  expect(facts.profiles[0]?.fields[0]?.proposedValues).toEqual([6, 7, 8]);
  expect(() => automaticProposalDescription(before, [{ op: "removeLayer", layerId: "missing" }], board)).toThrow("invalid automatic proposal");
});

test("timing-only scope names non-base callers and trigger deltas keep exact overlap semantics", () => {
  const before = groundedLayout();
  before.layers[1]!.bindings[2] = { kind: "holdTap", tap: { code: "A" }, hold: { layerId: "factory" }, profileId: "home" };
  before.holdTapProfiles = [{ id: "home", name: "Home row", firmware: "zmk", options: { "tapping-term-ms": 200, "hold-trigger-key-positions": [1, 2, 3] } }];
  const compare = (positions: number[]) => proposalChanges(before, [{ op: "upsertHoldTapProfile", profile: { ...before.holdTapProfiles[0]!, options: { "tapping-term-ms": 240, "hold-trigger-key-positions": positions } } }], board);
  const unchanged = compare([1, 2, 3]);
  expect(unchanged.changedSlots).toEqual([]);
  expect(unchanged.callers).toContainEqual({ profileName: "Home row", phase: "current", layerId: "tools", layerName: "Tools", slots: [{ layerId: "tools", position: 2 }] });
  expect(unchanged.callers).toContainEqual({ profileName: "Home row", phase: "proposed", layerId: "tools", layerName: "Tools", slots: [{ layerId: "tools", position: 2 }] });
  expect(unchanged.triggers).toEqual([]);
  expect(compare([2, 3, 4]).triggers[0]).toEqual({ profileName: "Home row", added: [4], removed: [1] });
  expect(compare([7, 8, 9]).triggers[0]).toEqual({ profileName: "Home row", added: [7, 8, 9], removed: [1, 2, 3] });
});
