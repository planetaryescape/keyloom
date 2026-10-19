// The rules that only tap dances and text steps can break (16#tap-dance-is-a-key-with-a-double-tap-slot, D-156).
import { describe, expect, test } from "bun:test";
import type { ChangeOp } from "../../src/layout/change.ts";
import { bindingFunctions } from "../../src/layout/functions.ts";
import type { Binding, Layer, Layout, TapDance } from "../../src/layout/schema.ts";
import { layerGraph, reachableLayers, trappedLayers } from "../../src/validation/reachability.ts";
import { evaluate, validate } from "../../src/validation/validate.ts";
import { T, key, tiny, tinyBoard } from "../helpers/tiny.ts";

const at = (layerId: string, position: number) => ({ layerId, position });
const set = (layerId: string, position: number, binding: Binding): ChangeOp => ({ op: "setBinding", at: at(layerId, position), binding });
const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);
const td = (id: string): Binding => ({ kind: "tapDance", tapDanceId: id });
const escCaps: TapDance = { id: "esc-caps", name: "Esc and Caps", tap: key("ESCAPE") as TapDance["tap"], doubleTap: key("CAPS_LOCK") as TapDance["tap"] };
const upsert = (tapDance: TapDance): ChangeOp => ({ op: "upsertTapDance", tapDance });

/** The tiny layout with a layer of its own at the end, so one key can be a tap dance without losing anything. */
const withDances = (tapDances: TapDance[], bindings: Binding[] = [td(tapDances[0]?.id ?? "x"), key("B"), T, key("D")], over: Partial<Layout> = {}): Layout => {
  const base = tiny({ tapDances, ...over });
  return { ...base, layers: base.layers.map((l, i): Layer => (i === 0 ? { ...l, bindings: [...bindings, ...l.bindings.slice(bindings.length)] } : l)) };
};

describe("slots are functions", () => {
  test("a tap dance produces one function per filled slot, and the same strings a plain key would", () => {
    const full: TapDance = { ...escCaps, hold: { kind: "modifier", mods: ["LSFT"] }, tapThenHold: { kind: "layer", action: "toggle", layerId: "num" } };
    expect(bindingFunctions(td("esc-caps"), [full])).toEqual(["key:ESCAPE", "mod:LSFT", "key:CAPS_LOCK", "layer:toggle:num"]);
    expect(bindingFunctions({ kind: "key", code: "ESCAPE" })).toEqual(["key:ESCAPE"]);
    expect(bindingFunctions(td("nope"), [full])).toEqual([]);
  });

  test("replacing a tap dance loses a function only if no other key has it", () => {
    // Caps Lock is only on the dance; Escape is only on the dance too. Both must be licensed.
    const l = withDances([escCaps]);
    const lost = validate(tinyBoard, l, [set("base", 0, key("A"))]);
    expect(codes(lost.errors)).toEqual(["function_lost", "function_lost"]);
    expect(lost.errors.map((e) => e.function).sort()).toEqual(["key:CAPS_LOCK", "key:ESCAPE"]);
    const ok = validate(tinyBoard, l, [
      { op: "dropFunction", function: "key:ESCAPE", reason: "test" }, { op: "dropFunction", function: "key:CAPS_LOCK", reason: "test" }, set("base", 0, key("A")),
    ]);
    expect(ok.ok).toBe(true);
    expect(ok.diff.dropped.map((d) => d.function).sort()).toEqual(["key:CAPS_LOCK", "key:ESCAPE"]);
  });

  test("swapping a tap dance key keeps both functions, with no licence needed", () => {
    const l = withDances([escCaps]);
    const swapped = validate(tinyBoard, l, [{ op: "swapBindings", a: at("base", 0), b: at("base", 1) }]);
    expect(swapped.ok).toBe(true);
    expect(swapped.diff.relearnCount).toBeGreaterThan(0);
  });

  test("editing a tap dance's entry changes the keys that use it, though their binding is the same", () => {
    const l = withDances([escCaps]);
    const r = validate(tinyBoard, l, [upsert({ ...escCaps, doubleTap: key("TAB") as TapDance["tap"] }), { op: "dropFunction", function: "key:CAPS_LOCK", reason: "test" }]);
    expect(r.ok).toBe(true);
    expect(r.diff.changed).toEqual([at("base", 0)]);
  });
});

describe("references", () => {
  test("a key that names a tap dance the layout does not have, or a slot that names a missing layer or macro, is unknown_ref", () => {
    expect(codes(validate(tinyBoard, tiny(), [set("base", 3, td("ghost"))]).errors)).toEqual(["unknown_ref"]);
    const layerSlot: TapDance = { ...escCaps, hold: { kind: "layer", action: "momentary", layerId: "ghost" } };
    const r = validate(tinyBoard, tiny(), [upsert(layerSlot), set("base", 3, td("esc-caps"))]);
    expect(codes(r.errors)).toContain("unknown_ref");
    expect(r.errors.find((e) => e.code === "unknown_ref")?.plain).toMatch(/holding .* isn't in this layout/);
    const macroSlot: TapDance = { ...escCaps, doubleTap: { kind: "macro", macroId: "ghost" } };
    expect(codes(validate(tinyBoard, tiny(), [upsert(macroSlot)]).errors)).toContain("unknown_ref");
  });

  test("two tap dances with one id are refused, and removing one that a key uses leaves a dangling reference", () => {
    // A layout that arrives with the flaw stays editable, so the flaw shows as a warning rather than an error.
    const dup = withDances([escCaps, { ...escCaps, name: "Again" }]);
    expect(codes(validate(tinyBoard, dup, [set("base", 3, key("D"))]).warnings)).toContain("schema");
    const l = withDances([escCaps]);
    expect(validate(tinyBoard, l, [{ op: "removeTapDance", tapDanceId: "nope" }]).errors[0]?.code).toBe("unknown_ref");
    expect(codes(validate(tinyBoard, l, [{ op: "removeTapDance", tapDanceId: "esc-caps" }]).errors)).toContain("unknown_ref");
  });
});

describe("layers a tap dance reaches", () => {
  const layers = (dance: TapDance): Layout =>
    tiny({
      tapDances: [dance],
      layers: [
        { id: "base", name: "Base", bindings: [td(dance.id), key("B"), T, key("D")] },
        { id: "num", name: "Numbers", bindings: [key("N1"), key("N2"), T, key("N4")] },
      ],
      combos: [],
    });

  test("a hold slot that is a layer key is an edge, one per layer slot", () => {
    const l = layers({ ...escCaps, hold: { kind: "layer", action: "momentary", layerId: "num" }, doubleTap: { kind: "layer", action: "toggle", layerId: "num" } });
    expect(layerGraph(l).map((e) => [e.from, e.to, e.action])).toEqual([["base", "num", "momentary"], ["base", "num", "toggle"]]);
    expect([...reachableLayers(l)].sort()).toEqual(["base", "num"]);
  });

  test("a layer toggled on by a tap dance and left by none is a trap, like any toggle", () => {
    const l = layers({ ...escCaps, doubleTap: { kind: "layer", action: "toggle", layerId: "num" } });
    expect(trappedLayers(l).map((t) => t.layerId)).toEqual(["num"]);
    // The way back is a key on the layer, here a toggle of the same layer on its own key.
    const back: Layout = { ...l, layers: l.layers.map((layer) => (layer.id === "num" ? { ...layer, bindings: [key("N1"), key("N2"), { kind: "layer", action: "toggle", layerId: "num" }, key("N4")] } : layer)) };
    expect(trappedLayers(back)).toEqual([]);
  });

  test("a layer whose only way in was a tap dance's slot is unreachable once the dance goes", () => {
    const l = layers({ ...escCaps, hold: { kind: "layer", action: "momentary", layerId: "num" } });
    const r = validate(tinyBoard, l, [set("base", 0, key("A")), ...["key:ESCAPE", "key:CAPS_LOCK", "layer:momentary:num"].map((function_): ChangeOp => ({ op: "dropFunction", function: function_, reason: "t" }))]);
    expect(codes(r.errors)).toContain("layer_unreachable");
  });

  test("a momentary layer on the tap slot is refused: it would end the moment the dance does", () => {
    const l = layers({ ...escCaps, tap: { kind: "layer", action: "momentary", layerId: "num" } });
    expect(codes(validate(tinyBoard, tiny({ layers: l.layers }), [upsert(l.tapDances[0] as TapDance)]).errors)).toContain("tap_dance_slot");
  });
});

describe("tap and double-tap do the same", () => {
  const same: TapDance = { ...escCaps, doubleTap: key("ESCAPE") as TapDance["tap"] };

  test("is a warning that names the key and the two slots in words", () => {
    const r = validate(tinyBoard, tiny(), [upsert(same), set("base", 3, td("esc-caps")), { op: "dropFunction", function: "key:D", reason: "t" }]);
    expect(r.ok).toBe(true);
    const w = r.warnings.find((x) => x.code === "tap_dance_same_action");
    expect(w?.plain).toBe("The Esc key on Base: tapping and double-tapping do the same thing, so the extra slot adds nothing.");
    expect(w?.slots).toEqual([at("base", 3)]);
  });

  test("different slots do not warn, and hold against tap-then-hold does", () => {
    const r = validate(tinyBoard, tiny(), [upsert(escCaps), set("base", 3, td("esc-caps")), { op: "dropFunction", function: "key:D", reason: "t" }]);
    expect(codes(r.warnings)).not.toContain("tap_dance_same_action");
    const holds: TapDance = { ...escCaps, hold: { kind: "modifier", mods: ["LSFT"] }, tapThenHold: { kind: "modifier", mods: ["LSFT"] } };
    const h = validate(tinyBoard, tiny(), [upsert(holds), set("base", 3, td("esc-caps")), { op: "dropFunction", function: "key:D", reason: "t" }]);
    expect(h.warnings.find((x) => x.code === "tap_dance_same_action")?.plain).toContain("holding and tapping, then holding");
  });

  test("a warning already in the layout is not repeated by a later change", () => {
    const l = withDances([same]);
    expect(codes(validate(tinyBoard, l, [set("base", 1, key("C")), { op: "dropFunction", function: "key:B", reason: "t" }]).warnings)).not.toContain("tap_dance_same_action");
  });
});

describe("firmware limits", () => {
  const mixed: TapDance = { ...escCaps, doubleTap: { kind: "key", code: "A", mods: ["LSFT", "RCTL"] } };

  test("QMK refuses left and right modifiers in one slot, ZMK does not", () => {
    const qmk = validate(tinyBoard, tiny(), [upsert(mixed)]);
    expect(codes(qmk.errors)).toEqual(["qmk_tapdance_mixed_hands"]);
    const zmk = tiny({ firmware: "zmk" });
    expect(codes(evaluate({ ...tinyBoard, firmware: "zmk" }, zmk, [upsert(mixed)]).result.errors)).not.toContain("qmk_tapdance_mixed_hands");
  });

  test("a key keyloom doesn't know is refused", () => {
    const unknown: TapDance = { ...escCaps, doubleTap: { kind: "key", code: "NOT_A_KEY" } };
    expect(codes(validate(tinyBoard, tiny(), [upsert(unknown)]).errors)).toEqual(["firmware_unsupported"]);
  });

  test("a combo can use a tap dance key but not output one on QMK", () => {
    const l = withDances([escCaps]);
    const output = { id: "c2", name: "C2", positions: [1, 3], layerIds: "all" as const, output: td("esc-caps") };
    expect(codes(validate(tinyBoard, l, [{ op: "upsertCombo", combo: output }]).errors)).toEqual(["qmk_combo_tapdance"]);
    const input = { id: "c3", name: "C3", positions: [0, 2], layerIds: "all" as const, output: key("X") };
    expect(validate(tinyBoard, l, [{ op: "upsertCombo", combo: input }]).ok).toBe(true);
  });

  test("tap dances beside Oryx tap dance code that couldn't be read are refused", () => {
    const kept = { firmware: "qmk" as const, file: "keymap.c", anchor: "tap-dance", source: "/* oryx */", refersToLayerIndices: false };
    // The passthrough is untouched by the change, so the only thing wrong is the pair.
    expect(codes(validate(tinyBoard, tiny({ passthrough: [kept] }), [upsert(escCaps)]).errors)).toEqual(["tap_dance_native_conflict"]);
  });
});

describe("doubled letters", () => {
  test("a tap dance on a letter that doubles in words warns, and one on a letter that doesn't does not", () => {
    const on = (code: string): Layout => withDances([{ ...escCaps, tap: key(code) as TapDance["tap"] }]);
    const warn = (l: Layout) => codes(validate(tinyBoard, l, [set("base", 3, key("Z"))]).warnings);
    const fresh = (code: string) => validate(tinyBoard, tiny(), [upsert({ ...escCaps, tap: key(code) as TapDance["tap"] }), set("base", 3, td("esc-caps")), { op: "dropFunction", function: "key:D", reason: "t" }]).warnings;
    expect(codes(fresh("L"))).toContain("doubled_letter_tapdance");
    expect(codes(fresh("Q"))).not.toContain("doubled_letter_tapdance");
    expect(codes(fresh("ESCAPE"))).not.toContain("doubled_letter_tapdance");
    expect(warn(on("L"))).not.toContain("doubled_letter_tapdance"); // already there before the change, so not news
  });
});

describe("text steps", () => {
  const macro = (text: string): ChangeOp => ({ op: "upsertMacro", macro: { id: "t", name: "Text", steps: [{ op: "text", text }] } });

  test("US-layout characters are fine and the first character that can't be typed is named", () => {
    expect(validate(tinyBoard, tiny(), [macro("Hello, World! 42 {x} ~`|\\")]).ok).toBe(true);
    const bad = validate(tinyBoard, tiny(), [macro("café")]);
    expect(codes(bad.errors)).toEqual(["macro_text_untypable"]);
    expect(bad.errors[0]?.plain).toContain('"é"');
  });

  test("an empty text step is refused by the schema", () => {
    expect(codes(validate(tinyBoard, tiny(), [macro("")]).errors)).toEqual(["schema"]);
  });
});

describe("a macro that looks like a password", () => {
  const macro = (text: string): ChangeOp => ({ op: "upsertMacro", macro: { id: "t", name: "Login", steps: [{ op: "text", text }] } });

  test("warns, once, for text of eight or more characters with no spaces and a mix of kinds", () => {
    const w = validate(tinyBoard, tiny(), [macro("Tr0ub4dor&3")]).warnings.filter((x) => x.code === "macro_looks_like_secret");
    expect(w.map((x) => x.plain)).toEqual(['The macro "Login" types text that looks like a password. Anyone who has your keyboard could replay it.']);
    // Another change to the same layout does not repeat what it already had.
    const l = tiny({ macros: [{ id: "t", name: "Login", steps: [{ op: "text", text: "Tr0ub4dor&3" }] }] });
    expect(codes(validate(tinyBoard, l, [set("base", 1, key("C")), { op: "dropFunction", function: "key:B", reason: "t" }]).warnings)).not.toContain("macro_looks_like_secret");
  });

  test("ordinary text does not", () => {
    for (const text of ["git status", "Thanks, BK", "hello", "password", "ls -la ~/code", "https://example.com"]) {
      expect({ text, warned: codes(validate(tinyBoard, tiny(), [macro(text)]).warnings).includes("macro_looks_like_secret") }).toEqual({ text, warned: false });
    }
  });
});
