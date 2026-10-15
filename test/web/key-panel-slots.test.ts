import { describe, expect, test } from "bun:test";
import { bindingFromDraft, draftFromBinding } from "../../src/web/editor/draft.ts";
import {
  addHold, canAddHold, clearHold, hasHold, keyForChar, pickHold, pickTap, profileFor, tapKind, toggleHoldMod, toggleTapMod,
} from "../../src/web/panel/slots.ts";
import { loadFixture } from "../server/fixture.ts";

const { document: layout } = await loadFixture();
const empty = () => draftFromBinding({ kind: "transparent" }, layout, "base");
const asBinding = (draft: ReturnType<typeof empty>) => bindingFromDraft(draft, layout);

describe("the filled slots decide the binding kind (D-086)", () => {
  test("tap A is a key; adding a hold of Left Control makes it a hold-tap", () => {
    const a = pickTap(empty(), { t: "key", code: "A" });
    expect(tapKind(a)).toBe("key");
    expect(asBinding(a)).toEqual({ kind: "key", code: "A" });
    const waiting = addHold(a, layout.holdTapProfiles[0]?.id ?? null);
    expect(hasHold(waiting)).toBe(true);
    // The hold slot is open but empty, so there is nothing to apply yet.
    expect(asBinding(waiting)).toBeNull();
    const done = pickHold(waiting, { t: "mods", mods: ["LCTL"] });
    expect(asBinding(done)).toMatchObject({ kind: "holdTap", tap: { code: "A" }, hold: { mods: ["LCTL"] } });
  });

  test("clearing the hold goes back to the plain key and forgets the hold", () => {
    const hold = pickHold(addHold(pickTap(empty(), { t: "key", code: "A" }), "p"), { t: "mods", mods: ["LSFT"] });
    const plain = clearHold(hold);
    expect(asBinding(plain)).toEqual({ kind: "key", code: "A" });
    // Adding a hold again starts empty, not with the Shift that was cleared.
    expect(asBinding(addHold(plain, "p"))).toBeNull();
    expect(addHold(plain, "p").holdMods).toEqual([]);
  });

  test("a layer hold, and modifiers toggled onto either slot", () => {
    const hold = pickHold(addHold(pickTap(empty(), { t: "key", code: "SPACE" }), "p"), { t: "layer", layerId: "nav" });
    expect(asBinding(hold)).toMatchObject({ kind: "holdTap", hold: { layerId: "nav" } });
    const more = toggleHoldMod(pickHold(addHold(pickTap(empty(), { t: "key", code: "S" }), "p"), { t: "mods", mods: ["LCTL"] }), "LSFT");
    expect(asBinding(more)).toMatchObject({ hold: { mods: ["LCTL", "LSFT"] } });
    const shifted = toggleTapMod(pickTap(empty(), { t: "key", code: "N1" }), "LSFT");
    expect(asBinding(shifted)).toEqual({ kind: "key", code: "N1", mods: ["LSFT"] });
  });

  test("a lone modifier key is a modifier binding, and keeps being one that can grow", () => {
    const ctrl = pickTap(empty(), { t: "key", code: "LEFT_CTRL" });
    expect(tapKind(ctrl)).toBe("modifier");
    expect(asBinding(ctrl)).toEqual({ kind: "modifier", mods: ["LCTL"] });
    expect(asBinding(toggleTapMod(ctrl, "LSFT"))).toEqual({ kind: "modifier", mods: ["LCTL", "LSFT"] });
  });

  test("a modifier on the slot goes with the next key picked: Ctrl then A is Ctrl+A", () => {
    const draft = pickTap(pickTap(empty(), { t: "key", code: "LEFT_CTRL" }), { t: "key", code: "A" });
    expect(asBinding(draft)).toEqual({ kind: "key", code: "A", mods: ["LCTL"] });
  });

  test("a hold-tap taps only keys: other picks leave it alone, and a lone modifier key can take a hold", () => {
    const hold = pickHold(addHold(pickTap(empty(), { t: "key", code: "A" }), "p"), { t: "mods", mods: ["LCTL"] });
    expect(pickTap(hold, { t: "layer", action: "momentary", layerId: "nav" })).toBe(hold);
    expect(asBinding(pickTap(hold, { t: "key", code: "B" }))).toMatchObject({ tap: { code: "B" } });
    const ctrl = pickTap(empty(), { t: "key", code: "LEFT_CTRL" });
    expect(canAddHold(ctrl)).toBe(true);
    expect(asBinding(pickHold(addHold(ctrl, "p"), { t: "mods", mods: ["LSFT"] }))).toMatchObject({ tap: { code: "LEFT_CTRL" }, hold: { mods: ["LSFT"] } });
  });

  test("layers, macros, transparent and none each fill the tap slot and take no hold", () => {
    const layer = pickTap(empty(), { t: "layer", action: "toggle", layerId: "nav" });
    expect(asBinding(layer)).toEqual({ kind: "layer", action: "toggle", layerId: "nav" });
    expect(canAddHold(layer)).toBe(false);
    expect(addHold(layer, "p")).toBe(layer);
    const macro = layout.macros[0]?.id;
    if (macro !== undefined) expect(asBinding(pickTap(empty(), { t: "macro", macroId: macro }))).toEqual({ kind: "macro", macroId: macro });
    expect(asBinding(pickTap(layer, { t: "none" }))).toEqual({ kind: "none" });
    expect(asBinding(pickTap(layer, { t: "transparent" }))).toEqual({ kind: "transparent" });
  });
});

describe("a draft picks the timing profile for what the hold is", () => {
  const profiles = [
    { id: "home-row-mods", name: "Home-row mods", firmware: "qmk" as const, options: {} },
    { id: "mod-tap", name: "Mod-tap", firmware: "qmk" as const, options: {} },
    { id: "layer-tap", name: "Layer-tap", firmware: "qmk" as const, options: {} },
  ];
  const withProfiles = { ...layout, holdTapProfiles: profiles };

  test("home-row keys get home-row mods, others mod-tap, layer holds layer-tap", () => {
    expect(profileFor(withProfiles, "mods", true)).toBe("home-row-mods");
    expect(profileFor(withProfiles, "mods", false)).toBe("mod-tap");
    expect(profileFor(withProfiles, "layer", true)).toBe("layer-tap");
  });

  test("a layout with only one profile, or none, falls back to it", () => {
    expect(profileFor({ ...layout, holdTapProfiles: [profiles[2] as never] }, "mods", false)).toBe("layer-tap");
    expect(profileFor({ ...layout, holdTapProfiles: [] }, "mods", false)).toBeNull();
  });

  test("ZMK-style ids are read too", () => {
    const zmk = { ...layout, holdTapProfiles: [{ id: "lt", name: "Layer-Tap", firmware: "zmk" as const, options: {} }, { id: "hm", name: "Home-row mod", firmware: "zmk" as const, options: {} }] };
    expect(profileFor(zmk, "mods", true)).toBe("hm");
    expect(profileFor(zmk, "layer", false)).toBe("lt");
  });
});

describe("typing a character fills the tap slot", () => {
  test("letters in either case, digits, punctuation and space find their key", () => {
    expect(keyForChar("a")?.name).toBe("A");
    expect(keyForChar("A")?.name).toBe("A");
    expect(keyForChar("7")?.name).toBe("N7");
    expect(keyForChar(";")?.name).toBe("SEMICOLON");
    expect(keyForChar(" ")?.name).toBe("SPACE");
  });

  test("anything that is not one printable key finds nothing", () => {
    expect(keyForChar("Enter")).toBeUndefined();
    expect(keyForChar("")).toBeUndefined();
    expect(keyForChar("é")).toBeUndefined();
  });
});
