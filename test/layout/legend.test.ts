import { describe, expect, test } from "bun:test";
import { bindingLegend, layerLegend, macroLegend } from "../../src/layout/legend.ts";

const ctx = {
  layers: [
    { id: "base", name: "Layer 0" },
    { id: "nav", name: "Navigation" },
    { id: "odd", name: "Layer 7" },
  ],
  macros: [{ id: "m-one" }, { id: "copy", name: "Copy, switch, paste" }, { id: "slot", name: "ST_MACRO_2" }, { id: "long", name: "Screenshot region" }],
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

  test("modifiers print before the key in Apple's order, either side alike, and Hyper and Meh as marks (D-267)", () => {
    expect(bindingLegend({ kind: "key", code: "N4", mods: ["LGUI", "LSFT"] }, ctx).tap).toBe("⇧⌘4");
    expect(bindingLegend({ kind: "key", code: "B", mods: ["RCTL"] }, ctx).tap).toBe("⌃B");
    expect(bindingLegend({ kind: "modifier", mods: ["LCTL", "LSFT", "LALT", "LGUI"] }, ctx).tap).toBe("✦");
    expect(bindingLegend({ kind: "modifier", mods: ["RCTL", "RSFT", "RALT"] }, ctx).tap).toBe("◆");
  });

  test("a shifted key prints the character it types, and a modifier key its symbol (D-270)", () => {
    expect(bindingLegend({ kind: "key", code: "N1", mods: ["LSFT"] }, ctx).tap).toBe("!");
    expect(bindingLegend({ kind: "key", code: "LEFT_BRACKET", mods: ["RSFT"] }, ctx).tap).toBe("{");
    expect(bindingLegend({ kind: "key", code: "LEFT_SHIFT" }, ctx).tap).toBe("⇧");
    expect(bindingLegend({ kind: "key", code: "AUDIO_VOL_UP" }, ctx).tap).toBe("Vol+");
    expect(bindingLegend({ kind: "key", code: "BRIGHTNESS_DOWN" }, ctx).tap).toBe("Bri−");
    expect(bindingLegend({ kind: "key", code: "PAGE_DOWN" }, ctx).tap).toBe("PgDn");
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
    ).toBe("Nav");
  });

  test("a layer key names its layer as people read it and spells out what the key does", () => {
    expect(bindingLegend({ kind: "layer", action: "momentary", layerId: "nav" }, ctx)).toEqual({ kind: "layer", tap: "Nav", hold: "hold" });
    expect(bindingLegend({ kind: "layer", action: "oneShot", layerId: "base" }, ctx).hold).toBe("once");
    expect(bindingLegend({ kind: "layer", action: "toggle", layerId: "base" }, ctx).hold).toBe("toggle");
    expect(bindingLegend({ kind: "layer", action: "to", layerId: "base" }, ctx).hold).toBe("go to");
  });

  test("a macro prints the first word of its name, and what it sends when the name is only the firmware's slot (D-270)", () => {
    const sends = { ...ctx, macros: [...ctx.macros, { id: "shot", name: "ST_MACRO_0", steps: [{ op: "tap" as const, code: "N4", mods: ["LSFT" as const, "LGUI" as const] }] }] };
    expect(bindingLegend({ kind: "macro", macroId: "copy" }, ctx)).toEqual({ kind: "macro", tap: "Copy" });
    expect(bindingLegend({ kind: "macro", macroId: "shot" }, sends).tap).toBe("⇧⌘4");
    expect(bindingLegend({ kind: "macro", macroId: "slot" }, ctx).tap).toBe("Macro");
    expect(bindingLegend({ kind: "macro", macroId: "long" }, ctx).tap).toBe("Scre");
    expect(bindingLegend({ kind: "macro", macroId: "gone" }, ctx).tap).toBe("Macro");
  });

  test("macroLegend skips punctuation and blanks, never prints a name longer than five characters, and says Macro when it knows nothing", () => {
    expect(macroLegend(0, "  , Paste plain")).toBe("Paste");
    expect(macroLegend(3, "")).toBe("Macro");
    expect(macroLegend(-1, "Copy")).toBe("Macro");
    expect(macroLegend(0, "ST_MACRO_1", [{ op: "tap", code: "LEFT_GUI" }, { op: "waitMs", ms: 100 }, { op: "tap", code: "C" }])).toBe("⌘…");
    expect([...macroLegend(0, "Supercalifragilistic")].length).toBeLessThanOrEqual(5);
  });

  test("Space with modifiers is the open-box mark, so Hyper+Space fits a cap", () => {
    expect(bindingLegend({ kind: "key", code: "SPACE", mods: ["LCTL", "LSFT", "LALT", "LGUI"] }, ctx).tap).toBe("✦␣");
    expect(bindingLegend({ kind: "key", code: "SPACE" }, ctx).tap).toBe("Space");
  });

  test("transparent and none print nothing", () => {
    expect(bindingLegend({ kind: "transparent" }, ctx).tap).toBe("");
    expect(bindingLegend({ kind: "none" }, ctx).tap).toBe("");
  });
});

// Every kind of firmware binding in BK's Moonlander and Glove80 layouts gets words, never its firmware spelling (D-270, P1 review).
describe("native bindings print human legends", () => {
  const native = (source: string, label = "X", firmware: "qmk" | "zmk" = "qmk") => bindingLegend({ kind: "native", firmware, source, label }, layered);
  const layered = {
    layers: [0, 1, 2, 3, 4, 5].map((i) => ({ id: `l${i}`, name: ["Base", "one_shot", "numbers", "Navigation", "Magic layer", "Game"][i] as string })),
    macros: [],
    passthrough: [
      { firmware: "qmk" as const, file: "keymap.c", anchor: "define:DUAL_FUNC_0", source: "#define DUAL_FUNC_0 LT(5, KC_4)\n", refersToLayerIndices: true },
      { firmware: "qmk" as const, file: "keymap.c", anchor: "process_record_user:DUAL_FUNC_0", source: "case DUAL_FUNC_0:\n if (record->tap.count > 0) { register_code16(KC_F5); } else { layer_move(5); }", refersToLayerIndices: false },
    ],
  };

  test("QMK one-shot modifiers, Oryx dual-function keys, lighting, mouse and boot", () => {
    expect(native("OSM(MOD_LSFT)")).toEqual({ kind: "native", tap: "⇧", hold: "once" });
    expect(native("OSM(MOD_RSFT)")).toEqual({ kind: "native", tap: "⇧", hold: "once" });
    expect(native("DUAL_FUNC_0")).toEqual({ kind: "native", tap: "F5", hold: "Game" });
    expect(native("RGB_HUD")).toEqual({ kind: "native", tap: "Hue−", hold: "lights" });
    expect(native("KC_MS_BTN2")).toEqual({ kind: "native", tap: "Right", hold: "mouse" });
    expect(native("KC_MS_LEFT")).toEqual({ kind: "native", tap: "←", hold: "mouse" });
    expect(native("QK_BOOT")).toEqual({ kind: "native", tap: "Boot", hold: "flash" });
  });

  test("ZMK sticky keys, layer-on-hold, magic, lighting, Bluetooth and output", () => {
    expect(native("&sticky_key_quick_release LEFT_SHIFT", "OS⇧", "zmk")).toEqual({ kind: "native", tap: "⇧", hold: "once" });
    expect(native("&layer_on_hold 2 ENTER", "Enter/OSL2", "zmk")).toEqual({ kind: "native", tap: "⏎", hold: "Numbers" });
    expect(native("&layer_on_hold 1 LA(SPACE)", "⌥SPC/OSL1", "zmk")).toEqual({ kind: "native", tap: "⌥␣", hold: "One shot" });
    expect(native("&magic 4 0", "magic/L4", "zmk")).toEqual({ kind: "native", tap: "Magic", hold: "Magic" });
    expect(native("&rgb_ug RGB_SPI", "SPI", "zmk")).toEqual({ kind: "native", tap: "Speed+", hold: "lights" });
    expect(native("&bt_0", "bt_0", "zmk")).toEqual({ kind: "native", tap: "BT 1" });
    expect(native("&bt BT_CLR_ALL", "CLR_ALL", "zmk")).toEqual({ kind: "native", tap: "Unpair", hold: "all" });
    expect(native("&out OUT_USB", "USB", "zmk")).toEqual({ kind: "native", tap: "USB", hold: "output" });
  });

  test("anything else keeps a label that is already a word, and is Custom otherwise; never the firmware's spelling", () => {
    expect(native("SOMETHING_NEW", "fn").tap).toBe("fn");
    expect(native("TD(DANCE_9)", "TD9").tap).toBe("Custom");
    expect(native("&some_behavior FOO", "SB_FOO", "zmk").tap).toBe("Custom");
  });
});

describe("layerLegend (D-270)", () => {
  test("a layer prints its name as people read it when it fits, its first word when not, else three letters", () => {
    expect(layerLegend("base", ctx)).toBe("Layer 0");
    expect(layerLegend("nav", ctx)).toBe("Nav");
    const named = { layers: [{ id: "a", name: "Left Hand" }, { id: "b", name: "default_layer" }, { id: "c", name: "numbers" }, { id: "d", name: "factory_test_layer" }], macros: [] };
    expect(layerLegend("a", named)).toBe("Left");
    expect(layerLegend("b", named)).toBe("Default");
    expect(layerLegend("c", named)).toBe("Numbers");
    expect(layerLegend("d", named)).toBe("Factory");
  });

  test("a label the person chose is printed as written", () => {
    expect(layerLegend("x", { layers: [{ id: "x", name: "Symbols", shortLabel: "SYM" }], macros: [] })).toBe("SYM");
  });

  test("an unknown id, including one shaped like an Object property, shows as written", () => {
    expect(layerLegend("ghost", ctx)).toBe("ghost");
    expect(layerLegend("constructor", ctx)).toBe("constructor");
  });
});
