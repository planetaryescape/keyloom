import { describe, expect, test } from "bun:test";
import { LayoutSchema, type Binding, type Layout } from "../../src/layout/schema.ts";
import { bindingLabel, keyLabelAt } from "../../src/web/keyboard/labels.ts";

function layoutWith(bindingsByLayer: Binding[][], extras: Partial<Layout> = {}): Layout {
  return LayoutSchema.parse({
    schemaVersion: 1,
    boardId: "zsa/moonlander",
    firmware: "qmk",
    layers: bindingsByLayer.map((bindings, index) => ({
      id: index === 0 ? "base" : `layer-${index}`,
      name: index === 0 ? "Base" : `Layer ${index}`,
      bindings,
    })),
    macros: [{ id: "opt", name: "Option twice", steps: [{ op: "tap", code: "O" }] }],
    combos: [],
    holdTapProfiles: [],
    settings: [],
    passthrough: [],
    ...extras,
  });
}

const EMPTY = layoutWith([[]]);

describe("bindingLabel", () => {
  test("key shows its code, with mod glyphs in front", () => {
    expect(bindingLabel({ kind: "key", code: "A" }, EMPTY)).toEqual({ main: "A", faded: false });
    expect(bindingLabel({ kind: "key", code: "1", mods: ["LSFT"] }, EMPTY)).toEqual({ main: "⇧1", faded: false });
  });

  test("modifier shows glyphs, and a left and right of the same modifier show once", () => {
    expect(bindingLabel({ kind: "modifier", mods: ["LCTL", "LSFT"] }, EMPTY).main).toBe("⌃⇧");
    expect(bindingLabel({ kind: "modifier", mods: ["LCTL", "RCTL"] }, EMPTY).main).toBe("⌃");
    expect(bindingLabel({ kind: "modifier", mods: ["RGUI"] }, EMPTY).main).toBe("⌘");
    expect(bindingLabel({ kind: "modifier", mods: ["LALT"] }, EMPTY).main).toBe("⌥");
  });

  test("hold-tap shows the tap label and a mod glyph for the hold", () => {
    const label = bindingLabel(
      {
        kind: "holdTap",
        tap: { code: "A" },
        hold: { mods: ["LCTL"] },
        profileId: "home-row",
      },
      EMPTY,
    );
    expect(label).toEqual({ main: "A", sub: "⌃", faded: false });
  });

  test("hold-tap with a layer hold shows the layer name", () => {
    const layout = layoutWith([[], []]);
    const label = bindingLabel(
      { kind: "holdTap", tap: { code: "SPACE" }, hold: { layerId: "layer-1" }, profileId: "p" },
      layout,
    );
    expect(label).toEqual({ main: "SPACE", sub: "Layer 1", faded: false });
  });

  test.each([
    ["momentary", "hold"],
    ["toggle", "toggle"],
    ["to", "go to"],
    ["oneShot", "one-shot"],
  ] as const)("layer action %s shows the layer name and the action", (action, text) => {
    const layout = layoutWith([[], []]);
    expect(bindingLabel({ kind: "layer", action, layerId: "layer-1" }, layout)).toEqual({
      main: "Layer 1",
      sub: text,
      faded: false,
    });
  });

  test("macro shows its name", () => {
    expect(bindingLabel({ kind: "macro", macroId: "opt" }, EMPTY).main).toBe("Option twice");
  });

  test("transparent is faded and has no label of its own", () => {
    expect(bindingLabel({ kind: "transparent" }, EMPTY)).toEqual({ main: "", faded: true });
  });

  test("none is blank", () => {
    expect(bindingLabel({ kind: "none" }, EMPTY)).toEqual({ main: "", faded: false });
  });

  test("native shows its label with a firmware badge", () => {
    expect(
      bindingLabel({ kind: "native", firmware: "qmk", source: "RGB_TOG", label: "RGB" }, EMPTY),
    ).toEqual({ main: "RGB", badge: "QMK", faded: false });
    expect(bindingLabel({ kind: "native", firmware: "zmk", source: "&bt", label: "BT" }, EMPTY).badge).toBe("ZMK");
  });

  test("an unknown layer or macro id is shown as the id, not as an inherited property", () => {
    const layout = layoutWith([[]]);
    expect(bindingLabel({ kind: "layer", action: "toggle", layerId: "toString" }, layout).main).toBe("toString");
    expect(bindingLabel({ kind: "macro", macroId: "constructor" }, layout).main).toBe("constructor");
  });

  test("a layer named like an Object prototype property resolves by id", () => {
    const layout = layoutWith([[], []], {});
    const named = LayoutSchema.parse({
      ...layout,
      layers: [
        { id: "base", name: "Base", bindings: [] },
        { id: "constructor", name: "Constructor layer", bindings: [] },
      ],
    });
    expect(bindingLabel({ kind: "layer", action: "momentary", layerId: "constructor" }, named).main).toBe(
      "Constructor layer",
    );
  });
});

describe("keyLabelAt", () => {
  test("a transparent key on a higher layer shows the base layer binding, faded", () => {
    const layout = layoutWith([
      [{ kind: "key", code: "Q" }],
      [{ kind: "transparent" }],
    ]);
    expect(keyLabelAt(layout, 1, 0)).toEqual({ main: "Q", faded: true });
  });

  test("a transparent key on the base layer, or over a transparent base, is blank and faded", () => {
    expect(keyLabelAt(layoutWith([[{ kind: "transparent" }]]), 0, 0)).toEqual({ main: "", faded: true });
    const layout = layoutWith([[{ kind: "transparent" }], [{ kind: "transparent" }]]);
    expect(keyLabelAt(layout, 1, 0)).toEqual({ main: "", faded: true });
  });

  test("an index outside the layer is blank rather than a crash", () => {
    expect(keyLabelAt(layoutWith([[{ kind: "key", code: "A" }]]), 0, 5)).toEqual({ main: "", faded: false });
    expect(keyLabelAt(layoutWith([[{ kind: "key", code: "A" }]]), 3, 0)).toEqual({ main: "", faded: false });
  });

  test("a non-transparent key ignores lower layers", () => {
    const layout = layoutWith([
      [{ kind: "key", code: "Q" }],
      [{ kind: "key", code: "W" }],
    ]);
    expect(keyLabelAt(layout, 1, 0)).toEqual({ main: "W", faded: false });
  });
});
