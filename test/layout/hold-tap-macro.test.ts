import { describe, expect, test } from "bun:test";
import { TapActionSchema, type Binding } from "../../src/layout/schema.ts";
import { canAddHold, addHold, pickTap, tapKind } from "../../src/web/panel/slots.ts";
import { draftFromBinding } from "../../src/web/editor/draft.ts";
import { bindingToDts } from "../../src/firmware/zmk/emit-binding.ts";
import { bindingToC } from "../../src/firmware/qmk/emit-binding.ts";
import { generateKanataSource, KBD_FILE } from "../../src/firmware/kanata/generate.ts";
import { macbook, richLayout } from "../helpers/macbook.ts";

describe("hold-tap with macro tap action", () => {
  test("TapActionSchema parses code and macroId formats", () => {
    expect(TapActionSchema.parse({ code: "SPACE" })).toEqual({ code: "SPACE" });
    expect(TapActionSchema.parse({ macroId: "paste-macro" })).toEqual({ code: "", macroId: "paste-macro" });
    expect(TapActionSchema.parse({ kind: "macro", macroId: "paste-macro" })).toEqual({ code: "", macroId: "paste-macro" });
  });

  test("canAddHold allows macro draft and addHold keeps macroId", () => {
    const layout = richLayout();
    const draft = draftFromBinding({ kind: "macro", macroId: "my-macro" }, layout, "base");
    expect(canAddHold(draft)).toBe(true);
    const withHoldDraft = addHold(draft, "test-profile");
    expect(withHoldDraft.kind).toBe("holdTap");
    expect(withHoldDraft.macroId).toBe("my-macro");
    expect(tapKind(withHoldDraft)).toBe("macro");

    const changedToKey = pickTap(withHoldDraft, { t: "key", code: "A" });
    expect(changedToKey.macroId).toBeNull();
    expect(changedToKey.tap.code).toBe("A");

    const backToMacro = pickTap(changedToKey, { t: "macro", macroId: "my-macro-2" });
    expect(backToMacro.macroId).toBe("my-macro-2");
    expect(backToMacro.tap.code).toBeNull();
  });

  test("ZMK emits holdTap with macro tap action", () => {
    const binding: Binding = {
      kind: "holdTap",
      tap: { code: "", macroId: "m1" },
      hold: { mods: ["LCTL"] },
      profileId: "hp_fast",
    };
    const ctx = {
      layerIndex: new Map([["base", 0]]),
      profileLabels: new Map([["hp_fast", "hp_fast"]]),
      macroLabels: new Map([["m1", "macro_m1"]]),
      tapDanceLabels: new Map<string, string>(),
    };
    expect(bindingToDts(binding, ctx)).toBe("&hp_fast LCTRL &macro_m1");
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
