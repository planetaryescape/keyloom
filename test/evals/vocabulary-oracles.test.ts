import { describe, expect, test } from "bun:test";
import { DIGITS, F_POSITION, HOME_POSITIONS, J_POSITION, TOP_POSITIONS, vocabularyFixture } from "../../evals/vocabulary-fixture.ts";
import { type VocabularyProposal, homeRowModsPasses, numberLayerPasses } from "../../evals/vocabulary-oracles.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import type { HoldTapProfile, Mod } from "../../src/layout/schema.ts";
import { validate } from "../../src/validation/validate.ts";

const { board, before } = vocabularyFixture();
const proposal = (ops: ChangeOp[]): VocabularyProposal => ({ ops, validation: validate(board, before, ops) });

function numberOps(): ChangeOp[] {
  return [
    { op: "addLayer", layer: { id: "numbers", name: "Numbers" }, afterLayerId: "base" },
    { op: "setBinding", at: { layerId: "base", position: 70 }, binding: { kind: "layer", action: "momentary", layerId: "numbers" } },
    ...DIGITS.flatMap((code, i): ChangeOp[] => [
      { op: "setBinding", at: { layerId: "numbers", position: HOME_POSITIONS[i]! }, binding: { kind: "key", code } },
      { op: "setBinding", at: { layerId: "numbers", position: TOP_POSITIONS[i]! }, binding: { kind: "key", code, mods: ["LSFT"] } },
    ]),
  ];
}

function modOps(constrained = true): ChangeOp[] {
  return [
    ...["left", "right"].map((hand): ChangeOp => {
      const options: HoldTapProfile["options"] = { bindings: "&kp &kp", flavor: "balanced", "tapping-term-ms": 200 };
      if (constrained) options["hold-trigger-key-positions"] = hand === "left" ? board.hands.right : board.hands.left;
      return { op: "upsertHoldTapProfile", profile: { id: `command-${hand}`, name: `${hand} Command`, firmware: "zmk", options } };
    }),
    { op: "setBinding", at: { layerId: "base", position: F_POSITION }, binding: { kind: "holdTap", tap: { code: "F" }, hold: { mods: ["LGUI"] }, profileId: "command-left" } },
    { op: "setBinding", at: { layerId: "base", position: J_POSITION }, binding: { kind: "holdTap", tap: { code: "J" }, hold: { mods: ["LGUI"] }, profileId: "command-right" } },
  ];
}

describe("number layer oracle (offline; not model-quality evidence)", () => {
  test("accepts reachable 1–0 with shifted symbols directly above on the same layer", () => {
    const p = proposal(numberOps());
    expect(p.validation.ok).toBe(true);
    expect(numberLayerPasses(board, before, p)).toBe(true);
  });

  test("accepts an existing target layer, not only addLayer", () => {
    const start = structuredClone(before);
    start.layers.push({ id: "numbers", name: "Numbers", bindings: Array.from({ length: board.keyCount }, () => ({ kind: "transparent" })) });
    const ops = numberOps().filter((op) => op.op !== "addLayer");
    expect(numberLayerPasses(board, start, { ops, validation: validate(board, start, ops) })).toBe(true);
  });

  test("rejects an unreachable new layer even though validate only warns", () => {
    const p = proposal(numberOps().filter((op) => !(op.op === "setBinding" && op.at.layerId === "base")));
    expect(p.validation.ok).toBe(true);
    expect(p.validation.warnings.some((w) => w.code === "layer_unreachable")).toBe(true);
    expect(numberLayerPasses(board, before, p)).toBe(false);
  });

  for (const [name, binding] of [
    ["a repeated digit", { kind: "key", code: "N1" }],
    ["a modified digit", { kind: "key", code: "N0", mods: ["LALT"] }],
  ] satisfies [string, Extract<ChangeOp, { op: "setBinding" }>["binding"]][]) {
    test(`rejects ${name}`, () => {
      const ops = numberOps();
      ops.push({ op: "setBinding", at: { layerId: "numbers", position: HOME_POSITIONS[9]! }, binding });
      expect(numberLayerPasses(board, before, proposal(ops))).toBe(false);
    });
  }

  test("rejects unshifted numbers above instead of symbols", () => {
    const ops = numberOps();
    ops.push({ op: "setBinding", at: { layerId: "numbers", position: TOP_POSITIONS[0]! }, binding: { kind: "key", code: "N1" } });
    expect(numberLayerPasses(board, before, proposal(ops))).toBe(false);
  });

  test("rejects symbols placed on a different layer", () => {
    const ops = numberOps().filter((op) => !(op.op === "setBinding" && op.at.layerId === "numbers" && TOP_POSITIONS.includes(op.at.position)));
    ops.push({ op: "addLayer", layer: { id: "symbols", name: "Symbols" }, afterLayerId: "numbers" },
      { op: "setBinding", at: { layerId: "base", position: 71 }, binding: { kind: "layer", action: "momentary", layerId: "symbols" } },
      ...DIGITS.map((code, i): ChangeOp => ({ op: "setBinding", at: { layerId: "symbols", position: TOP_POSITIONS[i]! }, binding: { kind: "key", code, mods: ["LSFT"] } })));
    const p = proposal(ops);
    expect(p.validation.ok).toBe(true);
    expect(numberLayerPasses(board, before, p)).toBe(false);
  });

  test("rejects moving a Base letter even if its function stays reachable", () => {
    const ops = numberOps();
    ops.push({ op: "swapBindings", a: { layerId: "base", position: F_POSITION }, b: { layerId: "base", position: 68 } });
    const p = proposal(ops);
    expect(p.validation.ok).toBe(true);
    expect(numberLayerPasses(board, before, p)).toBe(false);
  });

  test("revalidates instead of trusting a forged ok result", () => {
    const p = proposal(numberOps());
    p.ops = [...p.ops, { op: "setBinding", at: { layerId: "missing", position: 0 }, binding: { kind: "none" } }];
    expect(numberLayerPasses(board, before, p)).toBe(false);
  });

  test("rejects a proposal already reported invalid", () => {
    const p = proposal(numberOps());
    p.validation.ok = false;
    expect(numberLayerPasses(board, before, p)).toBe(false);
  });
});

describe("F/J home-row mod oracle (offline; not model-quality evidence)", () => {
  test("accepts separate opposite-hand profiles with no warning", () => {
    const p = proposal(modOps());
    expect(p.validation.ok).toBe(true);
    expect(p.validation.warnings).toEqual([]);
    expect(homeRowModsPasses(board, before, p)).toBe(true);
  });

  test("accepts unconstrained profiles only with the surfaced warnings for both keys", () => {
    const p = proposal(modOps(false));
    expect(p.validation.ok).toBe(true);
    expect(p.validation.warnings.filter((w) => w.code === "homerow_same_hand_mods")).toHaveLength(2);
    expect(homeRowModsPasses(board, before, p)).toBe(true);
    p.validation.warnings = [];
    expect(homeRowModsPasses(board, before, p)).toBe(false);
  });

  test("rejects one missing warning or a warning about an unrelated slot", () => {
    const p = proposal(modOps(false));
    p.validation.warnings = p.validation.warnings.slice(0, 1);
    expect(homeRowModsPasses(board, before, p)).toBe(false);
    p.validation.warnings = [{ code: "homerow_same_hand_mods", message: "some other key", slots: [{ layerId: "base", position: 0 }] }];
    expect(homeRowModsPasses(board, before, p)).toBe(false);
  });

  test("rejects reusing the left profile on J without surfacing its same-hand warning", () => {
    const ops = modOps();
    ops.push({ op: "setBinding", at: { layerId: "base", position: J_POSITION }, binding: { kind: "holdTap", tap: { code: "J" }, hold: { mods: ["LGUI"] }, profileId: "command-left" } });
    const p = proposal(ops);
    expect(p.validation.warnings.some((w) => w.code === "homerow_same_hand_mods")).toBe(true);
    p.validation.warnings = [];
    expect(homeRowModsPasses(board, before, p)).toBe(false);
  });

  test("rejects F alone without J", () => {
    const ops = modOps().filter((op) => !(op.op === "setBinding" && op.at.position === J_POSITION));
    expect(homeRowModsPasses(board, before, proposal(ops))).toBe(false);
  });

  for (const mods of [["RGUI"], ["LGUI", "LSFT"]] satisfies Mod[][]) {
    test(`rejects ${mods.join("+")} instead of LGUI only`, () => {
      const ops = modOps();
      ops.push({ op: "setBinding", at: { layerId: "base", position: J_POSITION }, binding: { kind: "holdTap", tap: { code: "J" }, hold: { mods }, profileId: "command-right" } });
      const p = proposal(ops);
      expect(p.validation.ok).toBe(true);
      expect(homeRowModsPasses(board, before, p)).toBe(false);
    });
  }

  test("rejects a changed tap even when another key preserves the original letter", () => {
    const ops = modOps();
    ops.push({ op: "setBinding", at: { layerId: "base", position: F_POSITION }, binding: { kind: "holdTap", tap: { code: "G" }, hold: { mods: ["LGUI"] }, profileId: "command-left" } },
      { op: "setBinding", at: { layerId: "base", position: 68 }, binding: { kind: "key", code: "F" } });
    const p = proposal(ops);
    expect(p.validation.ok).toBe(true);
    expect(homeRowModsPasses(board, before, p)).toBe(false);
  });

  test("rejects a missing profile even if the supplied validation claims ok", () => {
    const p = proposal(modOps());
    p.ops = p.ops.filter((op) => op.op !== "upsertHoldTapProfile");
    expect(homeRowModsPasses(board, before, p)).toBe(false);
  });
});
