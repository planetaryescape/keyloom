// Tap dance and text steps on ZMK: what the generator writes (S16 runs it; test/firmware/zmk/tap-dance.docker.test.ts).
import { describe, expect, test } from "bun:test";
import { GenerateError, generateZmkSource } from "../../../src/firmware/zmk/generate.ts";
import { importZmkSource } from "../../../src/firmware/zmk/import.ts";
import type { Binding, Layout, Macro, TapDance } from "../../../src/layout/schema.ts";
import { STYLE_FIXTURE, glove80 } from "../../helpers/zmk.ts";

const board = await glove80();
const { layout: imported } = await importZmkSource(STYLE_FIXTURE, board.definition);
const keymapOf = (layout: Layout) => generateZmkSource({ layout, board: board.definition, geometry: board.geometry, revisionId: "rev_T" }).files.find((f) => f.path.endsWith(".keymap"))?.content ?? "";

const escCaps: TapDance = { id: "esc-caps", name: "Esc and Caps", tap: { kind: "key", code: "ESCAPE" }, doubleTap: { kind: "key", code: "CAPS_LOCK" } };
const withDance = (td: TapDance, macros: Macro[] = [], position = 0): Layout => ({
  ...imported,
  macros: [...imported.macros, ...macros],
  tapDances: [td],
  layers: imported.layers.map((l, i) => (i === 0 ? { ...l, bindings: l.bindings.map((b, p): Binding => (p === position ? { kind: "tapDance", tapDanceId: td.id } : b)) } : l)),
});
/** The lines of one devicetree node, from its label to its closing brace. */
const node = (text: string, label: string): string => {
  const start = text.indexOf(`${label}: ${label} {`);
  return start < 0 ? "" : text.slice(start, text.indexOf("};", start) + 2);
};

describe("a tap dance node", () => {
  test("tap and double-tap are the two positions of a zmk,behavior-tap-dance, and the key calls it by label", () => {
    const text = keymapOf(withDance(escCaps));
    expect(node(text, "esc_caps")).toBe(
      [
        "esc_caps: esc_caps {",
        '            compatible = "zmk,behavior-tap-dance";',
        '            display-name = "Esc and Caps";',
        "            #binding-cells = <0>;",
        "            tapping-term-ms = <200>;",
        "            bindings = <&kp ESC>,",
        "                       <&kp CAPS>;",
        "        };",
      ].join("\n"),
    );
    expect(text).toMatch(/&esc_caps\s/);
    expect(text).not.toContain("esc_caps_hold");
  });

  test("a tap with no double-tap is one position, and the term is the dance's own", () => {
    const text = keymapOf(withDance({ id: "solo", name: "Solo", tap: { kind: "key", code: "A" }, hold: { kind: "modifier", mods: ["LSFT"] }, termMs: 150 }));
    expect(node(text, "solo")).toContain("tapping-term-ms = <150>;");
    expect(node(text, "solo")).toContain("bindings = <&solo_hold A LSHFT>;".replace("A LSHFT", "LSHFT A"));
  });

  test("a hold slot makes the first position a hold-tap, and a tap-then-hold slot the second", () => {
    const td: TapDance = {
      id: "all", name: "All", tap: { kind: "key", code: "A" }, hold: { kind: "layer", action: "momentary", layerId: imported.layers[1]?.id ?? "x" },
      doubleTap: { kind: "key", code: "B" }, tapThenHold: { kind: "modifier", mods: ["LGUI"] }, termMs: 220,
    };
    const text = keymapOf(withDance(td));
    expect(node(text, "all_hold")).toContain("bindings = <&mo>, <&kp>;");
    expect(node(text, "all_hold")).toContain('flavor = "tap-preferred";');
    expect(node(text, "all_hold")).toContain("tapping-term-ms = <220>;");
    expect(node(text, "all_tap_hold")).toContain("bindings = <&kp>, <&kp>;");
    expect(node(text, "all")).toContain("bindings = <&all_hold 1 A>,");
    expect(node(text, "all")).toContain("<&all_tap_hold LGUI B>;");
  });

  test("a macro or a toggle in a slot is written as that behaviour, with a dummy parameter where a hold-tap needs one", () => {
    const macro: Macro = { id: "m-hi", name: "Hi", steps: [{ op: "text", text: "Hi" }] };
    const td: TapDance = { id: "mac", name: "MAC", tap: { kind: "macro", macroId: "m-hi" }, hold: { kind: "macro", macroId: "m-hi" }, doubleTap: { kind: "layer", action: "toggle", layerId: imported.layers[1]?.id ?? "x" } };
    const text = keymapOf(withDance(td, [macro]));
    expect(node(text, "mac_hold")).toContain("bindings = <&m_hi>, <&m_hi>;");
    expect(node(text, "mac")).toContain("<&mac_hold 0 0>,");
    expect(node(text, "mac")).toContain("<&tog 1>;");
  });

  test("a tap-then-hold with no double-tap taps nothing in the second position", () => {
    const text = keymapOf(withDance({ id: "th", name: "TH", tap: { kind: "key", code: "A" }, tapThenHold: { kind: "key", code: "TAB" } }));
    expect(node(text, "th_tap_hold")).toContain("bindings = <&kp>, <&none>;");
  });

  test("missing layers, macros and clashing names are errors that say which dance", () => {
    expect(() => keymapOf(withDance({ ...escCaps, doubleTap: { kind: "macro", macroId: "ghost" } }))).toThrow(/tap dance "Esc and Caps".*"ghost"/);
    expect(() => keymapOf(withDance({ ...escCaps, hold: { kind: "layer", action: "momentary", layerId: "ghost" } }))).toThrow(GenerateError);
    expect(() => keymapOf(withDance({ ...escCaps, id: "kp" }))).toThrow(/&kp, which is a ZMK behaviour/);
    expect(() => keymapOf(withDance({ ...escCaps, id: "hm" }))).toThrow(/both be written as hm/);
  });
});

describe("text steps in a ZMK macro", () => {
  const macro = (text: string): Layout => ({ ...imported, macros: [...imported.macros, { id: "typed", name: "Typed", steps: [{ op: "text", text }] }] });
  const body = (layout: Layout) => node(keymapOf(layout), "typed").split("\n").filter((l) => l.includes("&kp") || l.includes("bindings")).join("\n");

  test("each character is a tap, with Left Shift where the character needs it", () => {
    expect(body(macro("Hi!"))).toBe("            bindings = <&kp LS(H)>,\n                       <&kp I>,\n                       <&kp LS(N1)>;");
  });

  test("a text step after a press or release step switches back to tapping first", () => {
    const l: Layout = { ...imported, macros: [...imported.macros, { id: "typed", name: "Typed", steps: [{ op: "press", code: "LEFT_SHIFT" }, { op: "release", code: "LEFT_SHIFT" }, { op: "text", text: "a" }] }] };
    expect(body(l)).toContain("&macro_tap &kp A");
  });

  test("a character that can't be typed is an error naming the macro and the character", () => {
    expect(() => keymapOf(macro("é"))).toThrow(/macro "typed": "é" can't be typed/);
  });
});
