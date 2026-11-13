// D-568: a modifier key can be held for the next key only, from the key card and the picker, through the same change path as any key.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { bindingLegend } from "../../src/layout/legend.ts";
import { oneShotModsOf, oneShotRefusal, writeOneShot } from "../../src/layout/one-shot-mods.ts";
import type { Binding, Firmware, Layout, Mod } from "../../src/layout/schema.ts";
import { validate } from "../../src/validation/validate.ts";
import { applyWords } from "../../src/web/card/card-words.ts";
import { bindingFromDraft, draftFromBinding, incompleteReason } from "../../src/web/editor/draft.ts";
import { keyChange } from "../../src/web/panel/change-ops.ts";
import { canAddExtraSlot } from "../../src/web/panel/dance.ts";
import { OneShotChoice } from "../../src/web/panel/OneShotChoice.tsx";
import { pickerSections, type PickerQuery } from "../../src/web/panel/picker-items.ts";
import { canAddHold, pickTap, setOneShot, toggleTapMod } from "../../src/web/panel/slots.ts";
import { tiny, tinyBoard } from "../helpers/tiny.ts";

const FIRMWARES: Firmware[] = ["qmk", "zmk", "kanata"];
const layoutFor = (firmware: Firmware): Layout => tiny({ firmware, holdTapProfiles: [{ id: "p", name: "P", firmware, options: {} }] });
const ctx = (layout: Layout) => ({ layers: layout.layers, macros: layout.macros, tapDances: layout.tapDances, passthrough: layout.passthrough });
const slot = { layerId: "base", position: 3 };

/** The key card's steps: a plain Shift on the key, then "For the next key only". */
function shiftOnce(layout: Layout) {
  const plain = draftFromBinding({ kind: "modifier", mods: ["LSFT"] }, layout, "base");
  const draft = setOneShot(plain, true);
  const binding = bindingFromDraft(draft, layout);
  if (binding === null) throw new Error("A single Shift must have a one-shot binding.");
  return { draft, binding };
}

describe("the key card writes a one-shot modifier in the board's own firmware", () => {
  test.each([
    ["qmk", "OSM(MOD_LSFT)"],
    ["zmk", "&sk LSHFT"],
    ["kanata", "(one-shot 2000 lshift)"],
  ] as const)("%s: Shift for the next key only is %s, the source writeSteps writes", (firmware, source) => {
    const layout = layoutFor(firmware);
    const { binding } = shiftOnce(layout);
    expect(binding).toMatchObject({ kind: "native", firmware, source });
    const written = writeOneShot(["LSFT"], firmware);
    if ("why" in written) throw new Error(written.why);
    expect(binding).toEqual(written.binding);
  });

  test.each(FIRMWARES)("%s: the key goes through the validator as a setBinding, and passes (D-014, D-451)", (firmware) => {
    const layout = layoutFor(firmware);
    const { draft, binding } = shiftOnce(layout);
    const change = keyChange({ layout, slot, draft, binding, original: { kind: "key", code: "A" }, placements: [], drops: new Map() });
    expect(change.ops).toEqual([{ op: "setBinding", at: slot, binding }]);
    const result = validate({ ...tinyBoard, firmware }, layout, change.ops);
    expect(result.errors).toEqual([]);
  });

  test.each(FIRMWARES)("%s: the applied key opens as a one-shot Shift, unchanged, and turns back into a plain Shift", (firmware) => {
    const layout = layoutFor(firmware);
    const written = shiftOnce(layout).binding;
    const reopened = draftFromBinding(written, layout, "base");
    expect(reopened).toMatchObject({ kind: "modifier", modifier: ["LSFT"], oneShot: true });
    expect(bindingFromDraft(reopened, layout)).toEqual(written);
    expect(bindingFromDraft(setOneShot(reopened, false), layout)).toEqual({ kind: "modifier", mods: ["LSFT"] });
  });

  test("an imported spelling is kept as written until its modifiers change", () => {
    const layout = layoutFor("zmk");
    const imported: Binding = { kind: "native", firmware: "zmk", source: "&sk LEFT_SHIFT", label: "LEFT_SHIFT" };
    const draft = draftFromBinding(imported, layout, "base");
    expect(bindingFromDraft(draft, layout)).toBe(imported);
    const toCommand = toggleTapMod(toggleTapMod(draft, "LSFT"), "LGUI");
    expect(bindingFromDraft(toCommand, layout)).toMatchObject({ source: "&sk LGUI" });
  });

  test("custom kanata timing stays native and unchanged", () => {
    const binding: Binding = { kind: "native", firmware: "kanata", source: "(one-shot 500 lshift)", label: "Shift" };
    const layout = layoutFor("kanata");
    const draft = draftFromBinding(binding, layout, "base");
    expect(draft.kind).toBe("native");
    expect(bindingFromDraft(draft, layout)).toEqual(binding);
  });

  test("a redefined ZMK sticky key stays native even when its press has the same meaning", () => {
    const binding: Binding = { kind: "native", firmware: "zmk", source: "&sk LSHFT", label: "Shift" };
    expect(writeOneShot(["LSFT"], "zmk", new Map([["sk", null]]))).toHaveProperty("why");
    expect(oneShotModsOf(binding, new Map([["sk", { compatible: "zmk,behavior-sticky-key", cells: [[{ name: "kp", params: [] }]], bindingCells: 1 }]]))).toBeNull();
  });

  test("a native that isn't a one-shot modifier, or is another firmware's, stays a kept key", () => {
    expect(oneShotModsOf({ kind: "native", firmware: "qmk", source: "QK_BOOT", label: "Boot" }, new Map())).toBeNull();
    expect(draftFromBinding({ kind: "native", firmware: "qmk", source: "OSM(MOD_LSFT)", label: "OS⇧" }, layoutFor("zmk"), "base").kind).toBe("native");
  });

  test("replacing another firmware's one-shot writes the current firmware", () => {
    const layout = layoutFor("zmk");
    const draft = draftFromBinding({ kind: "native", firmware: "qmk", source: "OSM(MOD_LSFT)", label: "Shift" }, layout, "base");
    expect(bindingFromDraft(pickTap(draft, { t: "oneShot", mods: ["LSFT"] }), layout)).toMatchObject({ firmware: "zmk", source: "&sk LSHFT" });
  });

  test("a one-shot modifier has no hold and no double tap to add, as a layer key has none", () => {
    const { draft } = shiftOnce(layoutFor("qmk"));
    expect(canAddHold(draft)).toBe(false);
    expect(canAddExtraSlot(draft)).toBe(false);
    expect(canAddHold(setOneShot(draft, false))).toBe(true);
  });
});

describe("a firmware that can't hold the modifiers says why, and what to change", () => {
  const twoMods: Mod[] = ["LCTL", "LSFT"];
  test.each([
    ["zmk", twoMods, "ZMK holds one modifier for the next key. Turn off all but one to use this."],
    ["kanata", twoMods, "kanata holds one modifier for the next key. Turn off all but one to use this."],
    ["qmk", ["LCTL", "RSFT"], "QMK holds left-hand or right-hand modifiers for the next key, not both. Use one side to use this."],
  ] as const)("%s refuses %j, with the reason beside the off choice and beside Apply", (firmware, mods, words) => {
    const layout = layoutFor(firmware);
    expect("why" in writeOneShot(mods, firmware)).toBe(true);
    expect(oneShotRefusal(mods, firmware)).toBe(words);
    const draft = { ...draftFromBinding({ kind: "modifier", mods: [...mods] }, layout, "base"), oneShot: true };
    expect(incompleteReason(draft, layout)).toBe(words);
    expect(bindingFromDraft(draft, layout)).toBeNull();
    const off = renderToStaticMarkup(<OneShotChoice mods={mods} on={false} firmware={firmware} onChange={() => {}} />);
    expect(off).toContain('disabled=""');
    expect(off).toContain(words);
  });

  test("QMK holds two modifiers of one side, and kanata and ZMK hold one", () => {
    expect(oneShotRefusal(twoMods, "qmk")).toBeNull();
    expect(writeOneShot(twoMods, "qmk")).toMatchObject({ binding: { source: "OSM(MOD_LCTL|MOD_LSFT)" } });
    expect(oneShotRefusal(["LGUI"], "zmk")).toBeNull();
  });

  test("turned on, the choice stays pressable so it can be turned off; on QMK it points at the timeout in Settings", () => {
    const qmk = renderToStaticMarkup(<OneShotChoice mods={["LSFT"]} on firmware="qmk" onChange={() => {}} />);
    expect(qmk).toContain('aria-pressed="true"');
    expect(qmk).not.toContain('disabled=""');
    expect(qmk).toContain("one-shot timeout");
    expect(qmk).toContain(">Settings</button>");
    // ZMK and kanata have no such setting on the settings page, so there is nothing to point at.
    expect(renderToStaticMarkup(<OneShotChoice mods={["LSFT"]} on firmware="zmk" onChange={() => {}} />)).not.toContain("Settings");
  });
});

describe("the picker lists one-shot modifiers where the firmware can write them", () => {
  const query = (firmware: Firmware, patch: Partial<PickerQuery> = {}): PickerQuery => ({
    text: "", tab: "modifiers", slot: "tap", keysOnly: false, layout: layoutFor(firmware), firmware, layerId: "base", layerAction: "momentary", ...patch,
  });
  const oneShots = (q: PickerQuery) => pickerSections(q).find((section) => section.id === "oneShot")?.items ?? [];

  test("QMK offers the four modifiers, Hyper and Meh; ZMK and kanata the four only", () => {
    expect(oneShots(query("qmk")).map((item) => item.label)).toEqual(["One-shot Control", "One-shot Option", "One-shot Shift", "One-shot Command", "One-shot Hyper", "One-shot Meh"]);
    for (const firmware of ["zmk", "kanata"] as const) {
      expect(oneShots(query(firmware)).map((item) => item.label)).toEqual(["One-shot Control", "One-shot Option", "One-shot Shift", "One-shot Command"]);
    }
    expect(pickerSections(query("qmk")).find((section) => section.id === "oneShot")?.title).toBe("For the next key only");
  });

  test("only the tap slot of a key with no hold offers them", () => {
    expect(oneShots(query("qmk", { slot: "hold" }))).toEqual([]);
    expect(oneShots(query("qmk", { keysOnly: true }))).toEqual([]);
    expect(oneShots(query("qmk", { hasExtraSlots: true }))).toEqual([]);
    expect(oneShots(query("qmk", { slot: "doubleTap" }))).toEqual([]);
    expect(oneShots(query("qmk", { tab: "letters" }))).toEqual([]);
  });

  test("a search finds them by sticky, one shot and once, after the plain keys", () => {
    for (const text of ["sticky", "one shot", "oneshot", "once", "one-shot"]) expect(oneShots(query("zmk", { text, tab: "letters" }))).toHaveLength(4);
    expect(oneShots(query("zmk", { text: "sticky shift", tab: "letters" })).map((item) => item.id)).toEqual(["oneshot-LSFT"]);
    const shift = pickerSections(query("qmk", { text: "shift", tab: "letters" })).flatMap((section) => section.items.map((item) => item.id));
    expect(shift.indexOf("key-LEFT_SHIFT")).toBeLessThan(shift.indexOf("oneshot-LSFT"));
  });

  test("a one-shot pick cannot discard a tap dance's extra actions", () => {
    const start = draftFromBinding({ kind: "modifier", mods: ["LSFT"] }, layoutFor("qmk"), "base");
    const dance = { ...start, doubleTap: { kind: "key", code: "A" } as const };
    expect(pickTap(dance, { t: "oneShot", mods: ["LSFT"] })).toBe(dance);
  });

  test("picking one makes the tap a one-shot, and picking a plain modifier key after it makes a plain one", () => {
    const layout = layoutFor("kanata");
    const start = draftFromBinding({ kind: "key", code: "A" }, layout, "base");
    const [item] = oneShots(query("kanata", { text: "command" }));
    const once = pickTap(start, item?.pick ?? { t: "none" });
    expect(bindingFromDraft(once, layout)).toMatchObject({ kind: "native", source: "(one-shot 2000 lmeta)" });
    expect(bindingFromDraft(pickTap(once, { t: "key", code: "LEFT_SHIFT" }), layout)).toEqual({ kind: "modifier", mods: ["LSFT"] });
  });
});

describe("the cap and the card's words", () => {
  test.each(FIRMWARES)("%s: the cap prints ⇧ once, as an imported one does, and Apply says what the key becomes", (firmware) => {
    const layout = layoutFor(firmware);
    const binding = shiftOnce(layout).binding;
    expect(bindingLegend(binding, ctx(layout))).toEqual({ kind: "native", tap: "⇧", hold: "once" });
    expect(applyWords({ kind: "modifier", mods: ["LSFT"] }, binding, layout)).toBe("Make it Shift for one key");
  });
});
