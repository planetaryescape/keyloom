import type { Binding } from "../../src/layout/schema.ts";
import { describe, expect, test } from "bun:test";
import {
  bindingFromDraft, changeSummary, draftFromBinding, incompleteReason, sameBinding, switchKind, toggleMod,
} from "../../src/web/editor/draft.ts";
import { searchKeys } from "../../src/web/editor/keysearch.ts";
import { loadFixture } from "../server/fixture.ts";

const { document: layout } = await loadFixture();
const from = (binding: Parameters<typeof draftFromBinding>[0], layerId = "base") =>
  draftFromBinding(binding, layout, layerId);

describe("draft round trips", () => {
  test("every kind survives binding to draft to binding", () => {
    const profile = layout.holdTapProfiles[0]?.id as string;
    const macro = layout.macros[0]?.id as string;
    const samples: Binding[] = [
      { kind: "key", code: "F17" },
      { kind: "key", code: "A", mods: ["LSFT", "LGUI"] },
      { kind: "modifier", mods: ["RALT"] },
      { kind: "holdTap", tap: { code: "S" }, hold: { mods: ["LALT"] }, profileId: profile },
      { kind: "holdTap", tap: { code: "SPACE", mods: ["LCTL"] }, hold: { layerId: "nav" }, profileId: profile },
      { kind: "layer", action: "toggle", layerId: "numbers" },
      { kind: "macro", macroId: macro },
      { kind: "transparent" },
      { kind: "none" },
      { kind: "native", firmware: "qmk", source: "QK_BOOT", label: "Boot" },
    ];
    for (const sample of samples) {
      const back = bindingFromDraft(from(sample), layout);
      expect(back).not.toBeNull();
      expect(sameBinding(back as never, sample)).toBe(true);
    }
  });

  test("mods are written in a fixed order and an empty list is dropped", () => {
    const draft = switchKind(from({ kind: "none" }), "key");
    draft.key = { code: "A", mods: [] };
    expect(bindingFromDraft(draft, layout)).toEqual({ kind: "key", code: "A" });
    draft.key.mods = toggleMod(toggleMod([], "RGUI"), "LCTL");
    expect(bindingFromDraft(draft, layout)).toEqual({ kind: "key", code: "A", mods: ["LCTL", "RGUI"] });
  });
});

describe("switching kind keeps what the two kinds share", () => {
  test("key to hold-tap and back keeps the key", () => {
    const hold = switchKind(from({ kind: "key", code: "S" }), "holdTap");
    expect(hold.tap.code).toBe("S");
    hold.tap = { code: "D", mods: [] };
    expect(switchKind(hold, "key").key.code).toBe("D");
  });

  test("modifier to hold-tap seeds the hold, and back", () => {
    const hold = switchKind(from({ kind: "modifier", mods: ["LCTL"] }), "holdTap");
    expect(hold.holdMods).toEqual(["LCTL"]);
    expect(hold.holdType).toBe("mods");
    hold.holdMods = ["LSFT"];
    expect(switchKind(hold, "modifier").modifier).toEqual(["LSFT"]);
  });

  test("a layer draft never targets the layer being edited by default", () => {
    expect(from({ kind: "none" }, "base").layerId).toBe("numbers");
  });
});

describe("incomplete drafts say why", () => {
  test("each kind names what is missing", () => {
    expect(incompleteReason(switchKind(from({ kind: "none" }), "key"), layout)).toBe("Pick a key.");
    expect(incompleteReason(switchKind(from({ kind: "none" }), "modifier"), layout)).toMatch(/modifier/);
    const bare = { ...layout, holdTapProfiles: [], macros: [] };
    expect(incompleteReason(switchKind(draftFromBinding({ kind: "none" }, bare, "base"), "holdTap"), bare)).toMatch(/Pick the key/);
    expect(incompleteReason(switchKind(draftFromBinding({ kind: "none" }, bare, "base"), "macro"), bare)).toMatch(/no macros/);
  });
});

describe("change summary", () => {
  test("names the layer, the 1-based key number and the new binding", () => {
    expect(changeSummary(layout, "base", 6, { kind: "key", code: "F17" })).toBe("Base, key 7: F17");
    expect(changeSummary(layout, "nav", 0, { kind: "key", code: "LEFT_ALT" })).toMatch(/^.+, key 1: Left Alt$/);
  });
});

describe("key search", () => {
  const first = (text: string, firmware: "qmk" | "zmk" = "qmk") => searchKeys({ text, firmware })[0]?.keys[0]?.name;

  test("finds by label, name, alias and group", () => {
    expect(first("f17")).toBe("F17");
    expect(first("enter")).toBe("ENTER");
    expect(first("kc_bspc")).toBe("BACKSPACE");
    // "return" is also the ZMK name of Enter, so Enter turns up beside the separate Return key.
    expect(searchKeys({ text: "return", firmware: "qmk" }).flatMap((g) => g.keys.map((k) => k.name))).toContain("ENTER");
    expect(searchKeys({ text: "media", firmware: "qmk" })[0]?.id).toBe("media");
  });

  test("no query returns every key in the fixed group order", () => {
    const groups = searchKeys({ text: "", firmware: "zmk" });
    expect(groups[0]?.title).toBe("Letters");
    expect(groups[2]?.title).toBe("F-keys");
    expect(groups[2]?.keys.some((key) => key.name === "F24")).toBe(true);
  });

  test("a QMK mod-tap can only tap basic keycodes", () => {
    const all = searchKeys({ text: "", firmware: "qmk" }).flatMap((g) => g.keys).length;
    const basic = searchKeys({ text: "", firmware: "qmk", qmkBasicOnly: true }).flatMap((g) => g.keys).length;
    expect(basic).toBeLessThanOrEqual(all);
    expect(searchKeys({ text: "", firmware: "zmk", qmkBasicOnly: true }).flatMap((g) => g.keys).length).toBe(all);
  });

  test("a query that matches nothing returns no groups", () => {
    expect(searchKeys({ text: "zzzzqq", firmware: "qmk" })).toEqual([]);
  });
});
