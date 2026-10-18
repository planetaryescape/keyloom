import { describe, expect, test } from "bun:test";
import { mirrorBinding, mirrorProfile, modsForHand } from "../../src/layout/mirror.ts";
import type { Binding, Layout } from "../../src/layout/schema.ts";

const hrm = (tap: string, mods: ("LCTL" | "LSFT" | "LALT" | "LGUI" | "RCTL" | "RSFT" | "RALT" | "RGUI")[], profileId = "home-row-mods"): Binding => ({
  kind: "holdTap", tap: { code: tap }, hold: { mods }, profileId,
});
const key = (code: string): Binding => ({ kind: "key", code });

describe("modsForHand", () => {
  test("left mods become right mods and keep their kind", () => {
    expect(modsForHand(["LGUI"], "right")).toEqual(["RGUI"]);
    expect(modsForHand(["LCTL", "LSFT", "LALT", "LGUI"], "right")).toEqual(["RCTL", "RSFT", "RALT", "RGUI"]);
  });
  test("the target's hand wins, so a result is never mixed (QMK rejects mixed hands)", () => {
    expect(modsForHand(["LSFT", "RGUI"], "right")).toEqual(["RSFT", "RGUI"]);
    expect(modsForHand(["LSFT", "RGUI"], "left")).toEqual(["LSFT", "LGUI"]);
  });
  test("a right mod mirrored to the left comes back as the left one", () => {
    expect(modsForHand(["RALT"], "left")).toEqual(["LALT"]);
  });
});

describe("mirrorBinding", () => {
  test("a hold-tap brings its hold, mirrored, and the target keeps its own letter", () => {
    expect(mirrorBinding(hrm("S", ["LALT"]), key("L"), "right")).toEqual({ binding: hrm("L", ["RALT"]) });
  });
  test("a target that already is a hold-tap keeps its tap and takes the new hold and profile", () => {
    expect(mirrorBinding(hrm("F", ["LGUI"], "p"), hrm("J", ["RCTL"], "q"), "right")).toEqual({ binding: hrm("J", ["RGUI"], "p") });
  });
  test("a target that is already the mirror is unchanged", () => {
    expect(mirrorBinding(hrm("F", ["LGUI"]), hrm("J", ["RGUI"]), "right")).toEqual({ unchanged: true });
  });
  test("a plain key on the source takes the hold off the target", () => {
    expect(mirrorBinding(key("D"), hrm("K", ["RCTL"]), "right")).toEqual({ binding: key("K") });
    expect(mirrorBinding(key("D"), key("K"), "right")).toEqual({ unchanged: true });
  });
  test("a layer hold keeps the layer, which has no hand", () => {
    const source: Binding = { kind: "holdTap", tap: { code: "SPACE" }, hold: { layerId: "layer-1" }, profileId: "lt" };
    expect(mirrorBinding(source, key("ENTER"), "right")).toEqual({ binding: { ...source, tap: { code: "ENTER" } } });
  });
  test("a modifier key mirrors to the target's hand", () => {
    expect(mirrorBinding({ kind: "modifier", mods: ["LSFT"] }, { kind: "none" }, "right")).toEqual({ binding: { kind: "modifier", mods: ["RSFT"] } });
  });
  test("a layer key, macro, transparent and none are copied whole", () => {
    const layer: Binding = { kind: "layer", action: "momentary", layerId: "layer-1" };
    expect(mirrorBinding(layer, key("X"), "right")).toEqual({ binding: layer });
    expect(mirrorBinding({ kind: "transparent" }, key("X"), "left")).toEqual({ binding: { kind: "transparent" } });
  });
  test("a target with no key of its own can't take a hold, and says why", () => {
    const result = mirrorBinding(hrm("S", ["LALT"]), { kind: "layer", action: "toggle", layerId: "layer-1" }, "right");
    expect(result).toEqual({ skip: expect.stringContaining("no key of its own") });
  });
  test("a modified key on the source is not a behaviour that mirrors", () => {
    expect(mirrorBinding({ kind: "key", code: "N1", mods: ["LSFT"] }, key("X"), "right")).toEqual({ skip: expect.stringContaining("modified key") });
  });
  test("a tap with modifiers stays with the target", () => {
    const target: Binding = { kind: "key", code: "N1", mods: ["LSFT"] };
    expect(mirrorBinding(hrm("S", ["LALT"]), target, "right")).toEqual({
      binding: { kind: "holdTap", tap: { code: "N1", mods: ["LSFT"] }, hold: { mods: ["RALT"] }, profileId: "home-row-mods" },
    });
  });
});

const layoutWith = (profiles: Layout["holdTapProfiles"]): Layout => ({
  schemaVersion: 1, boardId: "x/y", firmware: "zmk", layers: [{ id: "layer-0", name: "L0", bindings: [] }],
  macros: [], tapDances: [], combos: [], conditionalLayers: [], holdTapProfiles: profiles, settings: [], passthrough: [],
});
const partners = new Map([[0, 5], [1, 4], [2, 3], [5, 0], [4, 1], [3, 2]]);
const left = { id: "hrm-left", name: "Home row left", firmware: "zmk" as const, options: { flavor: "balanced", "tapping-term-ms": 200, "hold-trigger-key-positions": [3, 4, 5] } };

describe("mirrorProfile", () => {
  test("a ZMK profile that lists the other hand's keys gets a mirrored copy listing this hand's", () => {
    const result = mirrorProfile(layoutWith([left]), "hrm-left", partners);
    expect(result).toEqual({
      profileId: "hrm-left-mirrored",
      upsert: { id: "hrm-left-mirrored", name: "Home row left (mirrored)", firmware: "zmk", options: { flavor: "balanced", "tapping-term-ms": 200, "hold-trigger-key-positions": [0, 1, 2] } },
    });
  });
  test("a profile the layout already has with those options is reused, so a second run adds nothing", () => {
    const right = { ...left, id: "hrm-right", options: { ...left.options, "hold-trigger-key-positions": [0, 1, 2] } };
    expect(mirrorProfile(layoutWith([left, right]), "hrm-left", partners)).toEqual({ profileId: "hrm-right" });
    expect(mirrorProfile(layoutWith([left, right]), "hrm-right", partners)).toEqual({ profileId: "hrm-left" });
  });
  test("a profile without trigger positions is shared between the hands", () => {
    const plain = { id: "mt", name: "Mod-tap", firmware: "qmk" as const, options: { CHORDAL_HOLD: true } };
    expect(mirrorProfile(layoutWith([plain]), "mt", partners)).toEqual({ profileId: "mt" });
  });
  test("an unknown profile id is passed through for the validator to reject", () => {
    expect(mirrorProfile(layoutWith([]), "nope", partners)).toEqual({ profileId: "nope" });
  });
  test("a trigger position with no mirror position is skipped, not guessed", () => {
    const odd = { ...left, options: { ...left.options, "hold-trigger-key-positions": [3, 99] } };
    expect(mirrorProfile(layoutWith([odd]), "hrm-left", partners)).toEqual({ skip: expect.stringContaining("99") });
  });
  test("a name that is taken gets a numbered id", () => {
    const squatter = { ...left, id: "hrm-left-mirrored", options: { flavor: "tap-preferred" } };
    const result = mirrorProfile(layoutWith([left, squatter]), "hrm-left", partners);
    expect("upsert" in result && result.upsert?.id).toBe("hrm-left-mirrored-2");
  });
});
