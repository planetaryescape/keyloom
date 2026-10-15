import { describe, expect, test } from "bun:test";
import { bindingLegend, layerLegend } from "../../src/layout/legend.ts";

const ctx = {
  layers: [
    { id: "base", name: "Layer 0" },
    { id: "nav", name: "Navigation" },
    { id: "odd", name: "Layer 7" },
  ],
  macros: [{ id: "m-one" }],
};

describe("bindingLegend", () => {
  test("keys with a well-known symbol use it; the rest use the terminal's shared label", () => {
    expect(bindingLegend({ kind: "key", code: "BACKSPACE" }, ctx).tap).toBe("⌫");
    expect(bindingLegend({ kind: "key", code: "ENTER" }, ctx).tap).toBe("⏎");
    expect(bindingLegend({ kind: "key", code: "LEFT" }, ctx).tap).toBe("←");
    expect(bindingLegend({ kind: "key", code: "ESCAPE" }, ctx).tap).toBe("Esc");
    expect(bindingLegend({ kind: "key", code: "N1" }, ctx).tap).toBe("1");
    expect(bindingLegend({ kind: "key", code: "SEMICOLON" }, ctx).tap).toBe(";");
  });

  test("modifiers print before the key, in the terminal's glyphs", () => {
    expect(bindingLegend({ kind: "key", code: "N4", mods: ["LGUI", "LSFT"] }, ctx).tap).toBe("⌘⇧4");
    expect(bindingLegend({ kind: "modifier", mods: ["LCTL", "LSFT", "LALT", "LGUI"] }, ctx).tap).toBe("Hyp");
  });

  test("a hold-tap splits into a tap and a hold legend", () => {
    expect(
      bindingLegend({ kind: "holdTap", tap: { code: "S" }, hold: { mods: ["LALT"] }, profileId: "p" }, ctx),
    ).toEqual({
      kind: "holdTap",
      tap: "S",
      hold: "⌥",
    });
    expect(
      bindingLegend(
        { kind: "holdTap", tap: { code: "SPACE" }, hold: { layerId: "nav" }, profileId: "p" },
        ctx,
      ).hold,
    ).toBe("NAV");
  });

  test("a layer key names its layer and says what the key does", () => {
    expect(bindingLegend({ kind: "layer", action: "momentary", layerId: "nav" }, ctx)).toEqual({
      kind: "layer",
      tap: "NAV",
      hold: "hold",
    });
    expect(bindingLegend({ kind: "layer", action: "oneShot", layerId: "base" }, ctx).hold).toBe("once");
  });

  test("macros are numbered like the terminal grid, and an unknown one shows M?", () => {
    expect(bindingLegend({ kind: "macro", macroId: "m-one" }, ctx).tap).toBe("M0");
    expect(bindingLegend({ kind: "macro", macroId: "gone" }, ctx).tap).toBe("M?");
  });

  test("a long native label is shortened from a table, and a kept hold-tap splits into tap and hold", () => {
    const native = (label: string) => bindingLegend({ kind: "native", firmware: "qmk", source: "X", label }, ctx);
    expect(native("MSBTN2").tap).toBe("Btn2");
    expect(native("LyrCol").tap).toBe("LyrC");
    expect(native("Enter/OSL2")).toEqual({ kind: "native", tap: "Enter", hold: "OSL2" });
    // A short label with a slash is left whole, and so is a label that has more than one.
    expect(native("A/B").tap).toBe("A/B");
    expect(native("one/two/three").tap).toBe("one/two/three");
  });

  test("Space with modifiers is the open-box mark, so Hyper+Space fits a cap", () => {
    expect(bindingLegend({ kind: "key", code: "SPACE", mods: ["LCTL", "LSFT", "LALT", "LGUI"] }, ctx).tap).toBe("Hyp␣");
    expect(bindingLegend({ kind: "key", code: "SPACE" }, ctx).tap).toBe("Space");
  });

  test("native shows its own label; transparent and none print nothing", () => {
    expect(
      bindingLegend({ kind: "native", firmware: "qmk", source: "TD(DANCE_0)", label: "TD0" }, ctx).tap,
    ).toBe("TD0");
    expect(bindingLegend({ kind: "transparent" }, ctx).tap).toBe("");
    expect(bindingLegend({ kind: "none" }, ctx).tap).toBe("");
  });
});

describe("layerLegend", () => {
  test("a layer prints at most four letters, never its whole name", () => {
    expect(layerLegend("base", ctx)).toBe("L0");
    expect(layerLegend("nav", ctx)).toBe("NAV");
    expect(layerLegend("odd", ctx)).toBe("L7");
  });

  test("several words give their initials, and a short word stays whole", () => {
    const named = { layers: [{ id: "a", name: "Left Hand" }, { id: "b", name: "Fn" }, { id: "c", name: "Symbols" }], macros: [] };
    expect(layerLegend("a", named)).toBe("LH");
    expect(layerLegend("b", named)).toBe("FN");
    expect(layerLegend("c", named)).toBe("SYM");
  });

  test("layers that would print the same letters are told apart, by four letters or by position", () => {
    const four = { layers: [{ id: "a", name: "Navigate" }, { id: "b", name: "Nav" }], macros: [] };
    expect(layerLegend("a", four)).toBe("NAVI");
    expect(layerLegend("b", four)).toBe("NAV");
    const same = { layers: [{ id: "a", name: "Numbers" }, { id: "b", name: "Numbers" }], macros: [] };
    expect(layerLegend("a", same)).toBe("L0");
    expect(layerLegend("b", same)).toBe("L1");
  });

  test("an unknown id, including one shaped like an Object property, shows as written", () => {
    expect(layerLegend("ghost", ctx)).toBe("ghost");
    expect(layerLegend("constructor", ctx)).toBe("constructor");
  });
});
