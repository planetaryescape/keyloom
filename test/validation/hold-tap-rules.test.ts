import { describe, expect, test } from "bun:test";
import type { BoardDefinition } from "../../src/boards/schema.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import type { Binding, HoldTapProfile, Layout } from "../../src/layout/schema.ts";
import { validate } from "../../src/validation/validate.ts";
import { key, tiny, tinyBoard } from "../helpers/tiny.ts";

const at = (layerId: string, position: number) => ({ layerId, position });
const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);
const upsert = (profile: HoldTapProfile): ChangeOp => ({ op: "upsertHoldTapProfile", profile });

// Four keys on the home row, two to a hand, and a thumb row that is empty here.
const board = (): BoardDefinition => ({ ...tinyBoard, hands: { left: [0, 1], right: [2, 3] }, rows: { home: [0, 1, 2, 3], thumb: [] } });
const mod = (code: string, mods: Array<"LGUI" | "LALT">, profileId: string): Binding => ({ kind: "holdTap", tap: { code }, hold: { mods }, profileId });

function layout(firmware: "qmk" | "zmk", over: Partial<Layout> = {}): Layout {
  const base = tiny({ firmware, combos: [] });
  base.layers[0]!.bindings = [mod("A", ["LGUI"], "hrm"), key("B"), { kind: "layer", action: "momentary", layerId: "num" }, mod("D", ["LALT"], "hrm")];
  base.layers[2]!.bindings = base.layers[0]!.bindings;
  base.layers[1]!.bindings = [key("N1"), key("N2"), { kind: "transparent" }, key("N4")];
  base.holdTapProfiles = [{ id: "hrm", name: "Home-row mods", firmware, options: {} }];
  base.layers = base.layers.slice(0, 2);
  return { ...base, ...over };
}

describe("homerow_same_hand_mods (D-017, 07)", () => {
  test("QMK: a new home-row mod with no Chordal Hold warns once for its profile, naming its keys", () => {
    const before = layout("qmk");
    before.layers[0]!.bindings[0] = key("A");
    before.layers[0]!.bindings[3] = key("D");
    const r = validate(board(), before, [
      { op: "setBinding", at: at("base", 0), binding: mod("A", ["LGUI"], "hrm") },
      { op: "setBinding", at: at("base", 3), binding: mod("D", ["LALT"], "hrm") },
    ]);
    const warnings = r.warnings.filter((w) => w.code === "homerow_same_hand_mods");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.slots).toEqual([at("base", 0), at("base", 3)]);
    expect(warnings[0]?.message).toContain("CHORDAL_HOLD");
    expect(r.ok).toBe(true);
  });

  test("QMK: the layout-wide CHORDAL_HOLD setting, or the profile repeating it, is the constraint", () => {
    const wide = layout("qmk", { settings: [{ firmware: "qmk", key: "CHORDAL_HOLD", value: true }] });
    const noise = [{ op: "renameLayer", layerId: "num", name: "Nums" }] as ChangeOp[];
    const fresh = (l: Layout) => {
      l.layers[0]!.bindings[0] = key("A");
      return validate(board(), l, [{ op: "setBinding", at: at("base", 0), binding: mod("A", ["LGUI"], "hrm") }, ...noise]);
    };
    expect(codes(fresh(wide).warnings)).not.toContain("homerow_same_hand_mods");
    const profile = layout("qmk", { settings: [{ firmware: "qmk", key: "CHORDAL_HOLD", value: true }] });
    profile.holdTapProfiles = [{ id: "hrm", name: "H", firmware: "qmk", options: { CHORDAL_HOLD: true } }];
    expect(codes(fresh(profile).warnings)).not.toContain("homerow_same_hand_mods");
  });

  test("ZMK: needs hold-trigger-key-positions on the opposite hand; own-hand positions do not count", () => {
    const withPositions = (positions: number[]) => {
      const l = layout("zmk");
      l.holdTapProfiles = [{ id: "hrm", name: "H", firmware: "zmk", options: { flavor: "balanced", "hold-trigger-key-positions": positions } }];
      l.layers[0]!.bindings[3] = key("D");
      return validate(board(), l, [{ op: "setBinding", at: at("base", 3), binding: mod("D", ["LALT"], "hrm") }]);
    };
    // D is on the right hand (2, 3); the left hand is 0, 1.
    expect(codes(withPositions([0, 1]).warnings)).not.toContain("homerow_same_hand_mods");
    expect(codes(withPositions([0, 1, 2]).warnings)).toContain("homerow_same_hand_mods");
    expect(codes(withPositions([]).warnings)).toContain("homerow_same_hand_mods");
  });

  test("a thumb position in the list does not break the constraint", () => {
    const b = { ...board(), rows: { home: [0, 1, 2, 3], thumb: [2] } };
    const l = layout("zmk");
    l.holdTapProfiles = [{ id: "hrm", name: "H", firmware: "zmk", options: { "hold-trigger-key-positions": [0, 1, 2] } }];
    l.layers[0]!.bindings[3] = key("D");
    const r = validate(b, l, [{ op: "setBinding", at: at("base", 3), binding: mod("D", ["LALT"], "hrm") }]);
    expect(codes(r.warnings)).not.toContain("homerow_same_hand_mods");
  });

  test("a hazard that was already there is not news, and a hold on a layer or a non-letter is not the hazard", () => {
    const l = layout("qmk");
    // Already unconstrained before the change: an unrelated edit says nothing about it.
    expect(codes(validate(board(), l, [{ op: "renameLayer", layerId: "num", name: "Nums" }]).warnings)).not.toContain("homerow_same_hand_mods");
    const fresh = layout("qmk");
    fresh.layers[0]!.bindings = [key("A"), key("B"), key("C"), key("D")];
    const layerTap: Binding = { kind: "holdTap", tap: { code: "A" }, hold: { layerId: "num" }, profileId: "hrm" };
    const spaceTap: Binding = { kind: "holdTap", tap: { code: "SPACE" }, hold: { mods: ["LGUI"] }, profileId: "hrm" };
    const r = validate(board(), fresh, [
      { op: "setBinding", at: at("base", 0), binding: layerTap },
      { op: "setBinding", at: at("base", 1), binding: spaceTap },
    ]);
    expect(codes(r.warnings)).not.toContain("homerow_same_hand_mods");
  });

  test("a keyboard with no home row never warns", () => {
    const b = { ...board(), rows: {} };
    const l = layout("qmk");
    l.layers[0]!.bindings[0] = key("A");
    expect(codes(validate(b, l, [{ op: "setBinding", at: at("base", 0), binding: mod("A", ["LGUI"], "hrm") }]).warnings)).not.toContain("homerow_same_hand_mods");
  });
});

describe("hold-tap profile options the firmware cannot take", () => {
  test("QMK: TAPPING_TERM may differ per profile; an option QMK can't set per key is an error that names the key", () => {
    const l = layout("qmk");
    expect(validate(board(), l, [upsert({ id: "hrm", name: "H", firmware: "qmk", options: { TAPPING_TERM: 150, PERMISSIVE_HOLD: true } })]).ok).toBe(true);
    const bad = validate(board(), l, [upsert({ id: "hrm", name: "H", firmware: "qmk", options: { CHORDAL_HOLD: true } })]);
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toMatchObject({ code: "firmware_unsupported" });
    expect(bad.errors[0]?.message).toContain("CHORDAL_HOLD");
    expect(bad.errors[0]?.slots).toEqual([at("base", 0), at("base", 3)]);
  });

  test("QMK: the same option equal to the layout-wide setting is fine, and a string where a number belongs is not", () => {
    const l = layout("qmk", { settings: [{ firmware: "qmk", key: "CHORDAL_HOLD", value: true }] });
    expect(validate(board(), l, [upsert({ id: "hrm", name: "H", firmware: "qmk", options: { CHORDAL_HOLD: true } })]).ok).toBe(true);
    expect(validate(board(), l, [upsert({ id: "hrm", name: "H", firmware: "qmk", options: { TAPPING_TERM: "fast" } })]).ok).toBe(false);
  });

  test("QMK: two keys with the same tap and hold must agree, because QMK picks by keycode", () => {
    const l = layout("qmk");
    l.holdTapProfiles = [...l.holdTapProfiles, { id: "slow", name: "Slow", firmware: "qmk", options: { TAPPING_TERM: 250 } }];
    l.layers[0]!.bindings[1] = mod("A", ["LGUI"], "slow"); // same tap and hold as key 1 on profile hrm
    const r = validate(board(), l, [{ op: "renameLayer", layerId: "num", name: "Nums" }]);
    // Existing flaws are downgraded to warnings by the validator, so check through a change that adds it.
    const fresh = layout("qmk");
    fresh.holdTapProfiles = l.holdTapProfiles;
    const added = validate(board(), fresh, [{ op: "setBinding", at: at("base", 1), binding: mod("A", ["LGUI"], "slow") }]);
    expect(added.ok).toBe(false);
    expect(added.errors.find((e) => e.message.includes("TAPPING_TERM"))?.slots).toHaveLength(2);
    expect(r.ok).toBe(true);
  });

  test("ZMK: flavor, milliseconds and trigger positions are checked", () => {
    const l = layout("zmk");
    const ok = validate(board(), l, [upsert({ id: "hrm", name: "H", firmware: "zmk", options: { flavor: "balanced", "tapping-term-ms": 180, "quick-tap-ms": 120, "hold-trigger-key-positions": [0, 1] } })]);
    expect(ok.ok).toBe(true);
    const bad = (options: HoldTapProfile["options"]) => validate(board(), l, [upsert({ id: "hrm", name: "H", firmware: "zmk", options })]);
    expect(bad({ flavor: "fast" }).errors[0]?.message).toContain("flavor");
    expect(bad({ "tapping-term-ms": -5 }).errors[0]?.message).toContain("milliseconds");
    expect(bad({ "tapping-term-ms": "slow" }).ok).toBe(false);
    expect(bad({ "hold-trigger-key-positions": [0, 9] }).errors[0]?.message).toContain("0 to 3");
    expect(bad({ "bad name!": 1 }).ok).toBe(false);
  });
});
