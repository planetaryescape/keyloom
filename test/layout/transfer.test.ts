import { describe, expect, test } from "bun:test";
import { BindingTransfer, type TransferEnv, transferLighting } from "../../src/layout/transfer.ts";
import type { Binding, HoldTapProfile, Layout } from "../../src/layout/schema.ts";

const doc = (firmware: "qmk" | "zmk", over: Partial<Layout> = {}): Layout => ({
  schemaVersion: 1, boardId: "x/y", firmware,
  layers: [{ id: "base", name: "Base", bindings: Array.from({ length: 6 }, (): Binding => ({ kind: "key", code: "A" })) }, { id: "nav", name: "Nav", bindings: [] }],
  macros: [], tapDances: [], combos: [], holdTapProfiles: [], settings: [], passthrough: [], ...over,
});
// Positions 0-2 are the left hand, 3-5 the right; 2 and 3 are thumbs.
const handAt = (p: number) => (p < 0 ? null : p < 3 ? "left" as const : "right" as const);
const env = (source: Layout, target: Layout, layers: [string, string][] = [["base", "base"]]): TransferEnv => ({
  source, target, layers: new Map(layers), handAt, fingerAt: (p) => (p % 3 === 0 ? "pinky" : "index"),
  triggerPositions: (hand) => (hand === "left" ? [3, 4, 5, 2] : [0, 1, 2, 3]),
});
const holdTap = (tap: string, mods: ("LCTL" | "RCTL" | "LGUI")[], profileId = "p"): Binding => ({ kind: "holdTap", tap: { code: tap }, hold: { mods }, profileId });
const key = (code: string): Binding => ({ kind: "key", code });

describe("BindingTransfer", () => {
  test("a hold-tap keeps the target's letter and takes the modifiers of the hand it lands on", () => {
    const t = new BindingTransfer(env(doc("qmk"), doc("zmk")));
    const left = t.bind(holdTap("A", ["LCTL"]), key("Q"), 4);
    expect(left).toMatchObject({ binding: { kind: "holdTap", tap: { code: "Q" }, hold: { mods: ["RCTL"] } } });
    const right = t.bind(holdTap("A", ["RCTL"]), key("Q"), 0);
    expect(right).toMatchObject({ binding: { hold: { mods: ["LCTL"] } } });
  });

  test("a ZMK target with no profile gets one per hand that waits for the other hand, shared by the keys on that hand", () => {
    const t = new BindingTransfer(env(doc("qmk"), doc("zmk")));
    const a = t.bind(holdTap("A", ["LCTL"]), key("Q"), 0);
    const b = t.bind(holdTap("S", ["LGUI"]), key("W"), 1);
    const c = t.bind(holdTap("J", ["RCTL"]), key("Y"), 4);
    const id = (r: ReturnType<typeof t.bind>) => ("binding" in r && r.binding.kind === "holdTap" ? r.binding.profileId : "");
    expect(id(a)).toBe("home-row-mods-left");
    expect(id(b)).toBe("home-row-mods-left");
    expect(id(c)).toBe("home-row-mods-right");
    const profiles = t.prerequisiteOps().flatMap((o) => (o.op === "upsertHoldTapProfile" ? [o.profile] : []));
    expect(profiles.map((p) => p.id)).toEqual(["home-row-mods-left", "home-row-mods-right"]);
    expect(profiles[0]?.options["hold-trigger-key-positions"]).toEqual([3, 4, 5, 2]);
  });

  test("a profile the target already uses for that finger is reused, and nothing new is made", () => {
    const existing: HoldTapProfile = { id: "hm_left_pinky", name: "x", firmware: "zmk", options: { flavor: "balanced" } };
    const target = doc("zmk", { holdTapProfiles: [existing] });
    target.layers[0]!.bindings[3] = holdTap("Q", ["LGUI"], "hm_left_pinky");
    const t = new BindingTransfer(env(doc("qmk"), { ...target }));
    // Position 0 is a pinky on the left hand in this env, as is the existing key at 3 (hand right here, so it is not reused for the left).
    const r = t.bind(holdTap("A", ["LCTL"]), key("Q"), 0);
    expect("binding" in r && r.binding.kind === "holdTap" && r.binding.profileId).toBe("home-row-mods-left");
    const t2 = new BindingTransfer(env(doc("qmk"), { ...target }));
    const same = t2.bind(holdTap("A", ["RCTL"]), key("Q"), 3);
    expect("binding" in same && same.binding.kind === "holdTap" && same.binding.profileId).toBe("hm_left_pinky");
    expect(t2.prerequisiteOps()).toEqual([]);
  });

  test("a QMK target reuses a profile it has; it never gets a ZMK one", () => {
    const target = doc("qmk", { holdTapProfiles: [{ id: "home-row-mods", name: "h", firmware: "qmk", options: {} }] });
    target.layers[0]!.bindings[1] = holdTap("S", ["LGUI"], "home-row-mods");
    const t = new BindingTransfer(env(doc("zmk"), target));
    const r = t.bind(holdTap("A", ["LCTL"]), key("Q"), 0);
    expect("binding" in r && r.binding.kind === "holdTap" && r.binding.profileId).toBe("home-row-mods");
    expect(t.prerequisiteOps()).toEqual([]);
  });

  test("a layer key points at the matching layer, and without one is skipped with the layer's name", () => {
    const t = new BindingTransfer(env(doc("qmk"), doc("zmk"), [["base", "base"], ["nav", "nav"]]));
    expect(t.bind({ kind: "layer", action: "momentary", layerId: "nav" }, key("A"), 0)).toEqual({ binding: { kind: "layer", action: "momentary", layerId: "nav" } });
    const none = new BindingTransfer(env(doc("qmk"), doc("zmk"), [["base", "base"]])).bind({ kind: "layer", action: "toggle", layerId: "nav" }, key("A"), 0);
    expect(none).toEqual({ skip: "it switches to the Nav layer, and the target has no layer that does the same job" });
  });

  test("native code is not copied", () => {
    const r = new BindingTransfer(env(doc("qmk"), doc("zmk"))).bind({ kind: "native", firmware: "qmk", source: "DUAL_FUNC_0", label: "DF0" }, key("A"), 0);
    expect("skip" in r && r.skip).toContain("QMK code that only works on its own keyboard");
  });

  test("a macro already on the target with the same steps is reused; a new one is added once, and rollback removes it", () => {
    const steps = [{ op: "tap" as const, code: "A" }];
    const source = doc("qmk", { macros: [{ id: "m1", name: "M", steps }] });
    const target = doc("zmk", { macros: [{ id: "other", name: "Other", steps }] });
    expect(new BindingTransfer(env(source, target)).bind({ kind: "macro", macroId: "m1" }, key("A"), 0)).toEqual({ binding: { kind: "macro", macroId: "other" } });
    const t = new BindingTransfer(env(source, doc("zmk")));
    const cp = t.checkpoint();
    t.bind({ kind: "macro", macroId: "m1" }, key("A"), 0);
    expect(t.prerequisiteOps()).toHaveLength(1);
    t.rollback(cp);
    expect(t.prerequisiteOps()).toEqual([]);
  });

  test("a combo's modifier is copied as written (position -1 has no hand)", () => {
    const r = new BindingTransfer(env(doc("qmk"), doc("zmk"))).bind({ kind: "modifier", mods: ["RSFT"] }, { kind: "none" }, -1);
    expect(r).toEqual({ binding: { kind: "modifier", mods: ["RSFT"] } });
  });
});

describe("transferLighting", () => {
  const red: [number, number, number] = [0, 255, 255];
  const blue: [number, number, number] = [170, 255, 255];

  test("each coloured key's colour goes to the key it maps to; the layer colour carries over", () => {
    const r = transferLighting({ layer: blue, keys: { "3": red, "4": blue } }, new Map([[3, [10]], [4, [11]]]));
    // Key 4 is the layer colour, so it needs no entry.
    expect(r.lighting).toEqual({ layer: blue, keys: { "10": red } });
    expect(r.carried).toEqual([3, 4]);
    expect(r.lost).toEqual([]);
  });

  test("a coloured key with nowhere to go is reported, not moved to a neighbour", () => {
    const r = transferLighting({ keys: { "7": red } }, new Map());
    expect(r.lighting).toEqual({});
    expect(r.lost).toEqual([7]);
  });

  test("a colour goes to every key that maps from it, and the result does not depend on the order of the keys", () => {
    const a = transferLighting({ keys: { "1": red, "2": blue } }, new Map([[1, [5, 6]], [2, [7]]]));
    const b = transferLighting({ keys: { "2": blue, "1": red } }, new Map([[2, [7]], [1, [5, 6]]]));
    expect(a.lighting.keys).toEqual({ "5": red, "6": red, "7": blue });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
