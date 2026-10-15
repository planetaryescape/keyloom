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
    ).toBe("Navigation");
  });

  test("a layer key names its layer and says what the key does", () => {
    expect(bindingLegend({ kind: "layer", action: "momentary", layerId: "nav" }, ctx)).toEqual({
      kind: "layer",
      tap: "Navigation",
      hold: "hold",
    });
    expect(bindingLegend({ kind: "layer", action: "oneShot", layerId: "base" }, ctx).hold).toBe("one-shot");
  });

  test("macros are numbered like the terminal grid, and an unknown one shows M?", () => {
    expect(bindingLegend({ kind: "macro", macroId: "m-one" }, ctx).tap).toBe("M0");
    expect(bindingLegend({ kind: "macro", macroId: "gone" }, ctx).tap).toBe("M?");
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
  test("a layer still named for its position is shortened; a renamed one keeps its name", () => {
    expect(layerLegend("base", ctx)).toBe("L0");
    expect(layerLegend("nav", ctx)).toBe("Navigation");
  });

  test("a default-looking name that doesn't match the position is kept, not guessed", () => {
    expect(layerLegend("odd", ctx)).toBe("Layer 7");
  });

  test("an unknown id, including one shaped like an Object property, shows as written", () => {
    expect(layerLegend("ghost", ctx)).toBe("ghost");
    expect(layerLegend("constructor", ctx)).toBe("constructor");
  });
});
