import { describe, expect, test } from "bun:test";
import { BindingSchema, TapActionSchema, type Binding } from "../../src/layout/schema.ts";
import { canAddHold, addHold, clearHold, pickHold, pickTap, tapKind } from "../../src/web/panel/slots.ts";
import { bindingFromDraft, draftFromBinding, normalise, sameBinding } from "../../src/web/editor/draft.ts";
import { bindingToC } from "../../src/firmware/qmk/emit-binding.ts";
import { generateKanataSource, KBD_FILE } from "../../src/firmware/kanata/generate.ts";
import { macbook, richLayout } from "../helpers/macbook.ts";

describe("hold-tap with macro tap action", () => {
  test("TapActionSchema parses code and macroId formats", () => {
    expect(TapActionSchema.parse({ code: "SPACE" })).toEqual({ code: "SPACE" });
    expect(TapActionSchema.parse({ macroId: "paste-macro" })).toEqual({ code: "", macroId: "paste-macro" });
    expect(TapActionSchema.parse({ kind: "macro", macroId: "paste-macro" })).toEqual({ code: "", macroId: "paste-macro" });
  });

  test.each([{}, { code: "" }, { code: "A", macroId: "m1" }, { macroId: "m1", mods: ["LCTL"] }, { code: "", macroId: "m1", mods: ["LSFT"] }])("rejects missing or contradictory tap action %j", (tap) => {
    expect(TapActionSchema.safeParse(tap).success).toBe(false);
  });

  test("accepts the normalized empty code only with a macro, and keeps key modifiers", () => {
    expect(TapActionSchema.parse({ code: "", macroId: "m1" })).toEqual({ code: "", macroId: "m1" });
    expect(TapActionSchema.parse({ code: "A", mods: ["LCTL"] })).toEqual({ code: "A", mods: ["LCTL"] });
  });

  test("canAddHold allows macro draft and addHold keeps macroId", () => {
    const layout = richLayout();
    const draft = draftFromBinding({ kind: "macro", macroId: "my-macro" }, layout, "base");
    expect(canAddHold(draft)).toBe(true);
    const withHoldDraft = addHold(draft, "test-profile");
    expect(withHoldDraft.kind).toBe("holdTap");
    expect(withHoldDraft.macroId).toBe("my-macro");
    expect(tapKind(withHoldDraft)).toBe("macro");
    const complete = pickHold(withHoldDraft, { t: "mods", mods: ["LCTL"] });
    expect(BindingSchema.parse(bindingFromDraft(complete, layout))).toMatchObject({ kind: "holdTap", tap: { code: "", macroId: "my-macro" } });
    expect(bindingFromDraft(clearHold(complete), layout)).toEqual({ kind: "macro", macroId: "my-macro" });

    const changedToKey = pickTap(withHoldDraft, { t: "key", code: "A" });
    expect(changedToKey.macroId).toBeNull();
    expect(changedToKey.tap.code).toBe("A");

    const backToMacro = pickTap(changedToKey, { t: "macro", macroId: "my-macro-2" });
    expect(backToMacro.macroId).toBe("my-macro-2");
    expect(backToMacro.tap.code).toBeNull();
  });

  test("normalizing a macro tap preserves its function and distinguishes different macros", () => {
    const a: Binding = { kind: "holdTap", tap: { code: "", macroId: "first" }, hold: { mods: ["LCTL"] }, profileId: "p" };
    const b: Binding = { ...a, tap: { code: "", macroId: "second" } };
    expect(normalise(a)).toEqual(a);
    expect(sameBinding(a, b)).toBe(false);
  });

  test("QMK refuses holdTap with macro tap action with helpful error", () => {
    const binding: Binding = {
      kind: "holdTap",
      tap: { code: "", macroId: "m1" },
      hold: { mods: ["LCTL"] },
      profileId: "hp_fast",
    };
    const ctx = {
      layerIndex: new Map([["base", 0]]),
      macroNames: new Map([["m1", "M1"]]),
      tapDanceNames: new Map<string, string>(),
      profileTermMs: new Map<string, number>(),
    };
    expect(() => bindingToC(binding, ctx)).toThrow("QMK mod-tap and layer-tap cannot take a macro as the tap action; use a tap dance instead");
  });

  test("Kanata emits holdTap with macro tap action", () => {
    const layout = richLayout();
    layout.layers[0]!.bindings[0] = {
      kind: "holdTap",
      tap: { code: "", macroId: layout.macros[0]!.id },
      hold: { mods: ["LCTL"] },
      profileId: layout.holdTapProfiles[0]!.id,
    };
    const src = generateKanataSource({ layout, board: macbook(), layoutId: "lay_TEST", revisionId: "rev_TEST" });
    const content = src.files.find((f) => f.path === KBD_FILE)!.content;
    expect(content).toContain(`@m-${layout.macros[0]!.id}`);
  });
});
