import { describe, expect, test } from "bun:test";
import { describeKey, modsWords } from "../../src/layout/describe.ts";
import { type Binding, type Layout, LayoutSchema } from "../../src/layout/schema.ts";

function layoutWith(layers: Binding[][], extras: Partial<Layout> = {}): Layout {
  return LayoutSchema.parse({
    schemaVersion: 1,
    boardId: "zsa/moonlander",
    firmware: "qmk",
    layers: layers.map((bindings, index) => ({ id: `layer-${index}`, name: `Layer ${index}`, bindings })),
    macros: [
      {
        id: "paste",
        name: "Paste",
        steps: [
          { op: "tap", code: "LEFT_GUI" },
          { op: "waitMs", ms: 100 },
          { op: "tap", code: "V", mods: ["LSFT"] },
        ],
      },
    ],
    combos: [
      {
        id: "c1",
        name: "Combo 1",
        positions: [0, 1],
        layerIds: "all",
        output: { kind: "modifier", mods: ["LSFT"] },
      },
      {
        id: "c2",
        name: "Combo 2",
        positions: [1, 2],
        layerIds: ["layer-1"],
        output: { kind: "key", code: "MINUS" },
      },
    ],
    holdTapProfiles: [
      { id: "hrm", name: "Home-row mods", firmware: "qmk", options: { PERMISSIVE_HOLD: true } },
    ],
    settings: [],
    passthrough: [],
    ...extras,
  });
}

const layout = layoutWith([
  [
    { kind: "holdTap", tap: { code: "S" }, hold: { mods: ["LALT"] }, profileId: "hrm" },
    { kind: "layer", action: "toggle", layerId: "layer-1" },
    { kind: "macro", macroId: "paste" },
    { kind: "native", firmware: "qmk", source: "TD(DANCE_0)", label: "TD0" },
    { kind: "key", code: "MINUS" },
    { kind: "none" },
  ],
  [
    { kind: "transparent" },
    { kind: "transparent" },
    { kind: "key", code: "A" },
    { kind: "transparent" },
    { kind: "transparent" },
    { kind: "transparent" },
  ],
]);

describe("describeKey", () => {
  test("a hold-tap says what tap and hold do and names its profile and options", () => {
    const d = describeKey(layout, 0, 0);
    expect(d?.headline).toBe("Tap for S, hold for Left Alt");
    expect(d?.fields).toEqual([
      { label: "Tap", value: "S" },
      { label: "Hold", value: "Left Alt" },
      { label: "Profile", value: "Home-row mods" },
    ]);
    expect(d?.options).toEqual(["PERMISSIVE_HOLD: true"]);
  });

  test("a layer key gives its action, its layer, and the layer it points at", () => {
    const d = describeKey(layout, 0, 1);
    expect(d?.headline).toBe("Press to switch Layer 1 on or off");
    expect(d?.targetLayerId).toBe("layer-1");
  });

  test("a macro lists its steps in words", () => {
    expect(describeKey(layout, 0, 2)?.steps).toEqual(["Tap Left GUI", "Wait 100 ms", "Tap Left Shift + V"]);
  });

  test("a native binding gives its label, firmware and source code", () => {
    expect(describeKey(layout, 0, 3)?.fields).toEqual([
      { label: "Label", value: "TD0" },
      { label: "Firmware", value: "QMK" },
      { label: "Source", value: "TD(DANCE_0)", code: true },
    ]);
  });

  test("a punctuation key is named in words, not by its symbol", () => {
    expect(describeKey(layout, 0, 4)?.headline).toBe("Sends Minus");
  });

  test("a transparent key says what it shows through to, and keeps its own kind", () => {
    const d = describeKey(layout, 1, 0);
    expect(d?.kind).toBe("transparent");
    expect(d?.headline).toBe("Transparent: does what Layer 0 does here. Tap for S, hold for Left Alt");
    expect(d?.legend).toEqual({ kind: "transparent", tap: "S", hold: "⌥" });
  });

  test("a transparent key over nothing says so", () => {
    const stacked = layoutWith([[{ kind: "transparent" }], [{ kind: "transparent" }]]);
    expect(describeKey(stacked, 1, 0)?.headline).toBe("Transparent, and Layer 0 has nothing here either");
    const base = layoutWith([[{ kind: "transparent" }]]);
    expect(describeKey(base, 0, 0)?.headline).toBe(
      "Transparent, with no layer beneath it, so it does nothing",
    );
  });

  test("combos list the other keys, and say whether they apply on this layer", () => {
    expect(describeKey(layout, 0, 1)?.combos).toEqual([
      {
        name: "Combo 1",
        partners: [0],
        output: "Holds Left Shift while pressed",
        scope: "all layers",
        activeHere: true,
      },
      { name: "Combo 2", partners: [2], output: "Sends Minus", scope: "Layer 1", activeHere: false },
    ]);
    expect(describeKey(layout, 1, 1)?.combos.map((c) => c.activeHere)).toEqual([true, true]);
  });

  test("a position outside the layer is null, not a crash", () => {
    expect(describeKey(layout, 0, 99)).toBeNull();
    expect(describeKey(layout, 9, 0)).toBeNull();
  });
});

describe("modsWords", () => {
  test("names the two sets people name, and joins the rest", () => {
    expect(modsWords(["LCTL", "LSFT", "LALT", "LGUI"])).toBe("Hyper (Ctrl + Shift + Alt + GUI)");
    expect(modsWords(["LSFT", "RGUI"])).toBe("Left Shift + Right GUI");
  });
});
