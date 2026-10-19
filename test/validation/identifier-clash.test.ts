// `identifier_clash` (07#warnings): a name generation derives from an id must not be one the firmware already
// uses, and two of them must not be the same name. On ZMK that is a devicetree label; QMK has no such namespace.
import { describe, expect, test } from "bun:test";
import type { BoardDefinition } from "../../src/boards/schema.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import type { Binding, Layout, Macro } from "../../src/layout/schema.ts";
import { BUILTIN_PROFILES } from "../../src/firmware/zmk/builtins.ts";
import { ZMK_BEHAVIOR_LABELS, ZMK_BUILTIN_HOLD_TAPS, labelOf } from "../../src/layout/firmware-names.ts";
import { identifierClash } from "../../src/validation/identifier-rules.ts";
import { standingIssues, validate } from "../../src/validation/validate.ts";
import { key, tiny, tinyBoard } from "../helpers/tiny.ts";

const zmkBoard: BoardDefinition = { ...tinyBoard, firmware: "zmk" };
const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);
const macro = (id: string, name = id): Macro => ({ id, name, steps: [{ op: "tap", code: "A" }] });

/** A ZMK layout with every layer reachable by a key, so a test can add macros and combos without stranding one. */
function layout(over: Partial<Layout> = {}): Layout {
  const base = tiny({ firmware: "zmk", combos: [], holdTapProfiles: [], ...over });
  const nav: Binding[] = [key("A"), key("B"), { kind: "layer", action: "momentary", layerId: "num" }, key("D")];
  return {
    ...base,
    layers: [
      { id: "base", name: "Base", bindings: [key("A"), key("B"), { kind: "layer", action: "momentary", layerId: "nav" }, key("D")] },
      { id: "num", name: "Numbers", bindings: [key("N1"), key("N2"), { kind: "transparent" }, key("N4")] },
      { id: "nav", name: "Nav", bindings: nav },
    ],
  };
}

describe("identifier_clash: a generated name the firmware already owns", () => {
  test("a macro whose label is a ZMK behaviour label is a warning naming it", () => {
    const [issue, ...rest] = identifierClash(layout({ macros: [macro("kp", "Copy")] }));
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({ code: "identifier_clash" });
    expect(issue?.message).toContain('macro "kp"');
    expect(issue?.message).toContain('"kp"');
    expect(issue?.slots).toBeUndefined();
    expect(issue?.plain).toContain("Copy");
  });

  test("labels are case-sensitive, as devicetree is, so Mo is not mo", () => {
    expect(identifierClash(layout({ macros: [macro("Mo", "Momentary")] }))).toEqual([]);
  });

  test("a built-in hold-tap override is not a clash; a new profile named after another behaviour is", () => {
    const builtin = layout({ holdTapProfiles: [{ id: "mt", name: "Mod-Tap", firmware: "zmk", options: {} }] });
    expect(identifierClash(builtin)).toEqual([]);
    const clash = layout({ holdTapProfiles: [{ id: "kt", name: "Keys", firmware: "zmk", options: {} }] });
    expect(identifierClash(clash).map((i) => i.code)).toEqual(["identifier_clash"]);
  });

  test("a tap dance named after a behaviour is a warning", () => {
    const doc = layout({ tapDances: [{ id: "sk", name: "Sticky", tap: { kind: "key", code: "A" } }] });
    expect(identifierClash(doc).map((i) => i.code)).toEqual(["identifier_clash"]);
  });

  test("two ids that collapse to one label are one warning naming both", () => {
    const issues = identifierClash(layout({ macros: [macro("a-b", "Dash"), macro("a_b", "Underscore")] }));
    expect(issues.map((i) => i.code)).toEqual(["identifier_clash"]);
    expect(issues[0]?.message).toContain('"a-b"');
    expect(issues[0]?.message).toContain('"a_b"');
    expect(issues[0]?.message).toContain(labelOf("a-b"));
  });

  test("two combos whose display names write the same node are a warning", () => {
    const combo = (id: string, name: string) => ({ id, name, positions: [0, 1], layerIds: "all" as const, output: key("ESCAPE") });
    const issues = identifierClash(layout({ combos: [combo("a", "Esc"), combo("b", "Esc")] }));
    expect(issues.map((i) => i.code)).toEqual(["identifier_clash"]);
    expect(issues[0]?.message).toContain('"a"');
    expect(issues[0]?.message).toContain('"b"');
  });

  test("combos with different names, and macros named after keys, are fine", () => {
    const combo = (id: string, name: string) => ({ id, name, positions: [0, 1], layerIds: "all" as const, output: key("ESCAPE") });
    expect(identifierClash(layout({ combos: [combo("a", "Esc"), combo("b", "Caps")], macros: [macro("m1", "KC_A")] }))).toEqual([]);
  });

  test("QMK has no label namespace, so the same ids are not a clash", () => {
    const qmk = { ...layout({ macros: [macro("kp", "Copy")] }), firmware: "qmk" as const };
    expect(identifierClash(qmk)).toEqual([]);
  });
});

describe("identifier_clash: only what the change adds or alters", () => {
  const before = layout({ macros: [macro("kp", "Copy")] });

  test("a change that leaves an existing clash alone warns about nothing", () => {
    const r = validate(zmkBoard, before, [{ op: "renameLayer", layerId: "num", name: "Digits" }]);
    expect(r.ok).toBe(true);
    expect(codes(r.warnings)).toEqual([]);
  });

  test("a change that adds a clash warns about the one it adds", () => {
    const add: ChangeOp[] = [{ op: "upsertMacro", macro: macro("mo", "Momentary") }];
    const r = validate(zmkBoard, before, add);
    expect(r.ok).toBe(true);
    expect(codes(r.warnings)).toEqual(["identifier_clash"]);
    expect(r.warnings[0]?.message).toContain('macro "mo"');
  });

  test("the board review's standing check sees it too", () => {
    expect(standingIssues(zmkBoard, before).map((i) => i.code)).toContain("identifier_clash");
  });
});

describe("the shared names the rule reads", () => {
  test("the built-in hold-tap ids are the ones firmware/zmk/builtins.ts overrides", () => {
    expect([...ZMK_BUILTIN_HOLD_TAPS].sort()).toEqual([...BUILTIN_PROFILES.keys()].sort());
  });

  test("every built-in hold-tap is also a behaviour label, so the skip is the only reason it doesn't warn", () => {
    for (const id of ZMK_BUILTIN_HOLD_TAPS) expect(ZMK_BEHAVIOR_LABELS.has(id)).toBe(true);
  });
});
