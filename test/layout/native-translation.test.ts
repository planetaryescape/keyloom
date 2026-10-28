import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { type KeptMap, readNative } from "../../src/layout/native-read.ts";
import { keptDefinitions } from "../../src/layout/kept-behaviours.ts";
import { type Step } from "../../src/layout/native-meaning.ts";
import { type TargetFacts, writeSteps } from "../../src/layout/native-write.ts";
import { kanataWrittenByKeyloom, nativeAction } from "../../src/layout/kanata/natives.ts";
import { BindingTransfer, type TransferEnv } from "../../src/layout/transfer.ts";
import type { Binding, Layout, Mod, Passthrough } from "../../src/layout/schema.ts";

const MOONLANDER: TargetFacts = { board: "Moonlander", lighting: { supported: true }, bluetooth: false };
const CORNE: TargetFacts = { board: "Corne", lighting: { supported: false, because: "its lights are underglow" }, bluetooth: true };

// Synthetic kept nodes with the shape of a MoErgo keymap's behaviours (not BK's file): a sticky key, a magic-style hold of a layer
// with a macro tap, a two-step Bluetooth macro, and a hold-tap of a one-shot layer that keyloom does not read.
const KEPT: Passthrough[] = [
  pass("behavior:sticky_key_quick_release", `sticky_key_quick_release: sticky_key_quick_release {
    compatible = "zmk,behavior-sticky-key";
    label = "STICKY_KEY_QUICK_RELEASE";
    bindings = <&sk>;
    #binding-cells = <1>;
  };`),
  pass("behavior:magic", `magic: magic_hold_tap {
    compatible = "zmk,behavior-hold-tap";
    label = "MAGIC_HOLD_TAP";
    flavor = "tap-preferred";
    #binding-cells = <2>;
    bindings = <&mo>, <&rgb_ug_status_macro>;
  };`),
  pass("behavior:layer_on_hold", `layer_on_hold: layer_on_hold {
    compatible = "zmk,behavior-hold-tap";
    bindings = <&sl>, <&kp>;
  };`),
  pass("behavior:sticky_kp", `sticky_kp: sticky_kp {
    compatible = "zmk,behavior-sticky-key";
    #binding-cells = <1>;
    bindings = <&kp>;
  };`),
  pass("macro:bt_2", `bt_2: bt_profile_macro_2 {
    label = "BT_2";
    compatible = "zmk,behavior-macro";
    #binding-cells = <0>;
    bindings = <&out OUT_BLE &bt BT_SEL 2>;
  };`),
];

function pass(anchor: string, source: string): Passthrough {
  return { firmware: "zmk", file: "keymap.keymap", anchor, source, refersToLayerIndices: false };
}
const kept = (extra: Passthrough[] = []): KeptMap => keptDefinitions([...KEPT, ...extra]);

const zmk = (source: string, layerRefs?: Array<{ start: number; end: number; layerId: string }>) => ({ firmware: "zmk" as const, source, layerRefs });
const qmk = (source: string) => ({ firmware: "qmk" as const, source });

type NativeSourceFirmware = Parameters<typeof nativeAction>[0];

describe("reading a native binding", () => {
  test("QMK one-shot modifiers read as QMK's five-bit one-shot holds them, one hand at a time", () => {
    expect(readNative(qmk("OSM(MOD_LSFT)"), kept())).toEqual({ kind: "steps", steps: [{ kind: "oneShot", mods: ["LSFT"] }] });
    expect(readNative(qmk("OSM(MOD_LCTL|MOD_LSFT)"), kept())).toEqual({ kind: "steps", steps: [{ kind: "oneShot", mods: ["LCTL", "LSFT"] }] });
    // quantum/modifiers.h: the right-hand flag makes every modifier in the one-shot right-hand, so these are right Shift alone and right Ctrl with right Shift.
    expect(readNative(qmk("OSM(MOD_LSFT|MOD_RSFT)"), kept())).toEqual({ kind: "steps", steps: [{ kind: "oneShot", mods: ["RSFT"] }] });
    expect(readNative(qmk("OSM(MOD_LCTL|MOD_RSFT)"), kept())).toEqual({ kind: "steps", steps: [{ kind: "oneShot", mods: ["RCTL", "RSFT"] }] });
    expect(readNative(qmk("OSM(MOD_RCTL|MOD_RSFT)"), kept())).toEqual({ kind: "steps", steps: [{ kind: "oneShot", mods: ["RCTL", "RSFT"] }] });
  });

  test("a QMK source must be the whole canonical spelling: no spaces inside an identifier, no stray text", () => {
    expect(readNative(qmk("Q K_BOOT"), kept())).toEqual({ kind: "unknown" });
    expect(readNative(qmk("OSM(MOD_L SFT)"), kept())).toEqual({ kind: "unknown" });
    expect(readNative(qmk("OSM(MOD_FOO)"), kept())).toEqual({ kind: "unknown" });
    expect(readNative(qmk("KC_A CW_TOGG"), kept())).toEqual({ kind: "unknown" });
  });

  test("a ZMK source must be one call from its ampersand; spaces between its words and at its ends do not change it", () => {
    expect(readNative(zmk("garbage &caps_word"), kept())).toEqual({ kind: "unknown" });
    expect(readNative(zmk("&caps_word"), kept())).toEqual({ kind: "steps", steps: [{ kind: "capsWord" }] });
    expect(readNative(zmk("&caps_word "), kept())).toEqual({ kind: "steps", steps: [{ kind: "capsWord" }] });
    expect(readNative(zmk("&sk  LSHFT"), kept())).toEqual({ kind: "steps", steps: [{ kind: "oneShot", mods: ["LSFT"] }] });
    expect(readNative(zmk("&sk\tRCTRL"), kept())).toEqual({ kind: "steps", steps: [{ kind: "oneShot", mods: ["RCTL"] }] });
  });

  test("spaces around QMK's parentheses and bar read as the spelling they stand for; spaces inside a name don't", () => {
    expect(readNative(qmk("OSM( MOD_LSFT )"), kept())).toEqual({ kind: "steps", steps: [{ kind: "oneShot", mods: ["LSFT"] }] });
    expect(readNative(qmk("OSM(MOD_LCTL | MOD_LSFT)"), kept())).toEqual({ kind: "steps", steps: [{ kind: "oneShot", mods: ["LCTL", "LSFT"] }] });
    expect(readNative(qmk("OSM(MOD_L SFT)"), kept())).toEqual({ kind: "unknown" });
  });

  test("the base's kanata cases still translate, spaced ones included, through the reader and nativeAction (R1)", () => {
    // d5b226c's src/layout/kanata/natives.ts translated these QMK and ZMK forms; the spaced ones are the three from review.
    const cases: Array<[NativeSourceFirmware, string, string]> = [
      ["qmk", "CW_TOGG", "(caps-word-toggle 2000)"],
      ["qmk", "QK_CAPS_WORD_TOGGLE", "(caps-word-toggle 2000)"],
      ["qmk", "OSM(MOD_LSFT)", "(one-shot 2000 lshift)"],
      ["qmk", "OSM(MOD_RCTL)", "(one-shot 2000 rctrl)"],
      ["qmk", "OSM( MOD_LSFT )", "(one-shot 2000 lshift)"],
      ["zmk", "&caps_word", "(caps-word-toggle 2000)"],
      ["zmk", "&sk LSHIFT", "(one-shot 2000 lshift)"],
      ["zmk", "&sk RSHFT", "(one-shot 2000 rshift)"],
      ["zmk", "&sk  LSHFT", "(one-shot 2000 lshift)"],
      ["zmk", "&sk\tRCTRL", "(one-shot 2000 rctrl)"],
    ];
    for (const [firmware, source, action] of cases) expect(nativeAction(firmware, source, "here", kept())).toBe(action);
    // The inputs admission still refuses: the reader reads them as unknown, and nativeAction throws for them.
    for (const [firmware, source] of [["qmk", "Q K_BOOT"], ["qmk", "OSM(MOD_L SFT)"], ["zmk", "garbage &caps_word"]] as const) {
      expect(readNative({ firmware, source }, kept())).toEqual({ kind: "unknown" });
      expect(() => nativeAction(firmware, source, "here", kept())).toThrow("has no kanata equivalent");
    }
  });

  test("a kept definition with text before its ampersand is not read through", () => {
    const junk = [pass("behavior:junk", `junk: junk { compatible = "zmk,behavior-macro"; bindings = <garbage &caps_word>; };`)];
    expect(readNative(zmk("&junk"), kept(junk))).toEqual({ kind: "unknown" });
  });

  test("QMK's one-shot writer refuses a left and a right modifier together, since the flag would make both right-hand", () => {
    expect(writeSteps([{ kind: "oneShot", mods: ["LCTL", "RSFT"] }], "qmk", MOONLANDER)).toEqual({
      why: "QMK's one-shot holds all left-hand or all right-hand modifiers, not one of each",
    });
  });
  test("QMK keycodes it does not know, and a modifier it does not know, are unknown rather than guessed", () => {
    expect(readNative(qmk("OSM(MOD_FOO)"), kept())).toEqual({ kind: "unknown" });
    expect(readNative(qmk("DUAL_FUNC_0"), kept())).toEqual({ kind: "unknown" });
    expect(readNative(qmk("constructor"), kept())).toEqual({ kind: "unknown" });
  });

  test("QMK lighting, boot, reset and caps word read as their steps", () => {
    expect(readNative(qmk("RGB_HUI"), kept())).toEqual({ kind: "steps", steps: [{ kind: "lighting", op: "hueUp" }] });
    expect(readNative(qmk("QK_BOOT"), kept())).toEqual({ kind: "steps", steps: [{ kind: "bootloader" }] });
    expect(readNative(qmk("QK_REBOOT"), kept())).toEqual({ kind: "steps", steps: [{ kind: "reset" }] });
    expect(readNative(qmk("CW_TOGG"), kept())).toEqual({ kind: "steps", steps: [{ kind: "capsWord" }] });
  });

  test("ZMK builtins read, with both short and long modifier names, and a Bluetooth select", () => {
    expect(readNative(zmk("&sk LEFT_SHIFT"), kept())).toEqual({ kind: "steps", steps: [{ kind: "oneShot", mods: ["LSFT"] }] });
    expect(readNative(zmk("&sk RSHFT"), kept())).toEqual({ kind: "steps", steps: [{ kind: "oneShot", mods: ["RSFT"] }] });
    expect(readNative(zmk("&rgb_ug RGB_SPI"), kept())).toEqual({ kind: "steps", steps: [{ kind: "lighting", op: "speedUp" }] });
    expect(readNative(zmk("&bt BT_SEL 2"), kept())).toEqual({ kind: "steps", steps: [{ kind: "bluetoothSelect", profile: 2 }] });
    expect(readNative(zmk("&out OUT_BLE"), kept())).toEqual({ kind: "steps", steps: [{ kind: "output", to: "ble" }] });
  });

  test("a ZMK sticky key holding two modifiers, a name it doesn't know, or two calls in one binding is unknown", () => {
    expect(readNative(zmk("&sk LSHFT LCTRL"), kept())).toEqual({ kind: "unknown" });
    expect(readNative(zmk("&sk FOO"), kept())).toEqual({ kind: "unknown" });
    expect(readNative(zmk("&bootloader &sys_reset"), kept())).toEqual({ kind: "unknown" });
  });

  test("a kept sticky key reads as the one-shot it passes its parameter to", () => {
    expect(readNative(zmk("&sticky_key_quick_release LEFT_SHIFT"), kept())).toEqual({ kind: "steps", steps: [{ kind: "oneShot", mods: ["LSFT"] }] });
    expect(readNative(zmk("&sticky_key_quick_release RIGHT_SHIFT"), kept())).toEqual({ kind: "steps", steps: [{ kind: "oneShot", mods: ["RSFT"] }] });
  });

  test("a kept sticky key wrapping `&kp` reads as the one-shot of its modifier, as ZMK's custom sticky key does (K1)", () => {
    expect(readNative(zmk("&sticky_kp LEFT_SHIFT"), kept())).toEqual({ kind: "steps", steps: [{ kind: "oneShot", mods: ["LSFT"] }] });
    expect(readNative(zmk("&sticky_kp A"), kept())).toEqual({ kind: "unknown" });
  });


  test("a kept macro reads as all its steps, so the two-step Bluetooth profile macro is a select with an output", () => {
    expect(readNative(zmk("&bt_2"), kept())).toEqual({ kind: "steps", steps: [{ kind: "output", to: "ble" }, { kind: "bluetoothSelect", profile: 2 }] });
  });

  test("a kept macro called with parameters is unknown, because keyloom does not read a macro that takes them", () => {
    expect(readNative(zmk("&bt_2 1"), kept())).toEqual({ kind: "unknown" });
  });

  test("a hold-tap of a momentary layer reads as that layer, identified by its layerRefs, with its tap named", () => {
    // `&magic 5 0`: the layer number is 5, and layerRefs says which layer it is (the document, not the number, decides).
    const r = readNative(zmk("&magic 5 0", [{ start: 7, end: 8, layerId: "factory-test" }]), kept());
    expect(r).toEqual({ kind: "holdLayer", layerId: "factory-test", tap: "rgb_ug_status_macro", tapSteps: [] });
  });

  test("a macro's controls are modes, and the steps after them still read: `&macro_tap &bootloader` is a bootloader step", () => {
    const reset = pass("macro:reset_tap", `reset_tap: reset_tap { compatible = "zmk,behavior-macro"; #binding-cells = <0>; bindings = <&macro_tap &bootloader>; };`);
    expect(readNative(zmk("&reset_tap"), kept([reset]))).toEqual({ kind: "steps", steps: [{ kind: "bootloader" }] });
    const pressed = pass("macro:press_reset", `press_reset: press_reset { compatible = "zmk,behavior-macro"; #binding-cells = <0>; bindings = <&macro_press &sys_reset &macro_release &macro_pause_for_release &bt BT_CLR>; };`);
    expect(readNative(zmk("&press_reset"), kept([pressed]))).toEqual({ kind: "steps", steps: [{ kind: "reset" }, { kind: "bluetooth", op: "clear" }] });
  });

  test("a hold-tap whose tap is a macro with a bootloader step reads that step as the tap's (`&magic 1 0`)", () => {
    const reset = pass("macro:reset_tap", `reset_tap: reset_tap { compatible = "zmk,behavior-macro"; #binding-cells = <0>; bindings = <&macro_tap &bootloader>; };`);
    const hold = pass("behavior:reset_hold", `reset_hold: reset_hold { compatible = "zmk,behavior-hold-tap"; #binding-cells = <2>; bindings = <&mo>, <&reset_tap>; };`);
    expect(readNative(zmk("&reset_hold 1 0", [{ start: 12, end: 13, layerId: "nav" }]), kept([reset, hold]))).toEqual({
      kind: "holdLayer", layerId: "nav", tap: "reset_tap", tapSteps: [{ kind: "bootloader" }],
    });
  });

  test("a layer hold with no layerRefs is unknown, because its number can't be tied to a layer", () => {
    expect(readNative(zmk("&magic 5 0"), kept())).toEqual({ kind: "unknown" });
  });

  test("a one-shot layer hold (`&layer_on_hold`) is not a momentary layer, so it stays unknown", () => {
    expect(readNative(zmk("&layer_on_hold 2 ENTER", [{ start: 15, end: 16, layerId: "numbers" }]), kept())).toEqual({ kind: "unknown" });
  });

  test("a label kept twice does not resolve, whichever definition came first", () => {
    const twice = [pass("behavior:sticky_key_quick_release", `x: x { compatible = "zmk,behavior-macro"; bindings = <&caps_word>; };`)];
    const a = kept(twice);
    const b = keptDefinitions([...twice, ...KEPT]);
    expect(readNative(zmk("&sticky_key_quick_release LEFT_SHIFT"), a)).toEqual({ kind: "unknown" });
    expect(readNative(zmk("&sticky_key_quick_release LEFT_SHIFT"), b)).toEqual({ kind: "unknown" });
  });

  test("a name on the prototype is not a behaviour", () => {
    expect(readNative(zmk("&constructor"), kept())).toEqual({ kind: "unknown" });
    expect(readNative(zmk("&__proto__ LSHFT"), kept())).toEqual({ kind: "unknown" });
  });

  test("the reading only ever answers for QMK and ZMK; a kanata binding is its own source", () => {
    expect(readNative({ firmware: "kanata", source: "(one-shot 2000 lshift)" }, kept())).toEqual({ kind: "unknown" });
  });
});

describe("writing a meaning for a target", () => {
  test("a one-shot becomes the QMK OSM for its mods, the right-hand ones too", () => {
    expect(writeSteps([{ kind: "oneShot", mods: ["LSFT"] }], "qmk", MOONLANDER)).toMatchObject({ source: "OSM(MOD_LSFT)" });
    expect(writeSteps([{ kind: "oneShot", mods: ["RSFT"] }], "qmk", MOONLANDER)).toMatchObject({ source: "OSM(MOD_RSFT)" });
  });

  test("a ZMK sticky key holds one modifier, so a two-modifier one-shot is refused with that reason", () => {
    expect(writeSteps([{ kind: "oneShot", mods: ["LSFT", "LCTL"] }], "zmk", CORNE)).toEqual({ why: "a ZMK sticky key holds one modifier, and this one-shot holds more" });
  });

  test("selecting the USB output on a board with no Bluetooth says there is nothing to select", () => {
    expect(writeSteps([{ kind: "output", to: "usb" }], "qmk", MOONLANDER)).toEqual({ why: "Output: Moonlander has no Bluetooth, so there is no output to select" });
  });

  test("Bluetooth on a board without it is refused by name", () => {
    expect(writeSteps([{ kind: "bluetoothSelect", profile: 2 }], "qmk", MOONLANDER)).toEqual({ why: "Bluetooth: Moonlander has no Bluetooth" });
  });

  test("RGB keys on a board with no lighting keyloom writes are refused with the board's reason", () => {
    expect(writeSteps([{ kind: "lighting", op: "toggle" }], "zmk", CORNE)).toEqual({ why: "Corne can't carry the RGB light key: its lights are underglow" });
  });

  test("a two-step meaning is refused, since a key carries one step", () => {
    const steps: Step[] = [{ kind: "output", to: "usb" }, { kind: "capsWord" }];
    expect(writeSteps(steps, "zmk", CORNE)).toEqual({ why: "it does more than one thing at once, and a key carries one" });
  });

  test("kanata refuses a pair of modifiers as one one-shot, since kanata's one-shot takes one key or a chord (K2)", () => {
    expect(writeSteps([{ kind: "oneShot", mods: ["LCTL", "LALT"] }], "kanata", MOONLANDER)).toEqual({
      why: "kanata's one-shot holds one key, a layer or a chord, and a pair of modifiers is none of those",
    });
  });

  test("kanata writes a one-shot and caps word, and nothing else", () => {
    expect(writeSteps([{ kind: "oneShot", mods: ["LSFT"] }], "kanata", MOONLANDER)).toMatchObject({ source: "(one-shot 2000 lshift)" });
    expect(writeSteps([{ kind: "capsWord" }], "kanata", MOONLANDER)).toMatchObject({ source: "(caps-word-toggle 2000)" });
    expect(writeSteps([{ kind: "bootloader" }], "kanata", MOONLANDER)).toEqual({ why: "kanata has no action for it" });
  });

  test("a one-hand mod set read from QMK writes back to the same QMK one-shot, in any order (round trip)", () => {
    const hands: Mod[][] = [["LCTL", "LSFT", "LALT", "LGUI"], ["RCTL", "RSFT", "RALT", "RGUI"]];
    fc.assert(fc.property(fc.constantFrom(...hands), fc.uniqueArray(fc.constantFrom(0, 1, 2, 3), { minLength: 1, maxLength: 4 }), (hand, picked) => {
      const names = picked.map((i) => `MOD_${hand[i]}`).join("|");
      const read = readNative(qmk(`OSM(${names})`), kept());
      if (read.kind !== "steps") throw new Error("a QMK one-shot did not read");
      const written = writeSteps(read.steps, "qmk", MOONLANDER);
      if (!("source" in written)) throw new Error(written.why);
      expect(readNative(qmk(written.source), kept())).toEqual(read);
    }));
  });
});

describe("what the writers emit is admitted", () => {
  const steps: Step[] = [
    { kind: "oneShot", mods: ["LSFT"] }, { kind: "oneShot", mods: ["LCTL", "LALT"] }, { kind: "oneShot", mods: ["RSFT"] },
    { kind: "capsWord" }, { kind: "bootloader" }, { kind: "reset" },
    ...(["toggle", "hueUp", "hueDown", "satUp", "satDown", "briUp", "briDown", "speedUp", "speedDown", "effectNext", "effectPrev"] as const).map((op): Step => ({ kind: "lighting", op })),
    { kind: "bluetooth", op: "clear" }, { kind: "bluetooth", op: "clearAll" }, { kind: "bluetooth", op: "next" }, { kind: "bluetooth", op: "previous" },
    { kind: "bluetoothSelect", profile: 0 }, { kind: "output", to: "usb" }, { kind: "output", to: "ble" },
  ];
  test("every QMK spelling the writer emits reads back to the same step", () => {
    for (const step of steps) {
      const written = writeSteps([step], "qmk", MOONLANDER);
      if (!("source" in written)) continue;
      expect(readNative(qmk(written.source), kept())).toEqual({ kind: "steps", steps: [step] });
    }
  });
  test("every ZMK spelling the writer emits reads back to the same step", () => {
    for (const step of steps) {
      const written = writeSteps([step], "zmk", CORNE);
      if (!("source" in written)) continue;
      expect(readNative(zmk(written.source), kept())).toEqual({ kind: "steps", steps: [step] });
    }
  });
});

describe("kanata natives the validator admits", () => {
  test("the kanata forms kanataSource writes are admitted, and nothing else", () => {
    expect(kanataWrittenByKeyloom("(one-shot 2000 lshift)")).toBe(true);
    expect(kanataWrittenByKeyloom("(one-shot 2000 lshift )")).toBe(false);
    // kanata's one-shot takes one key, a layer or a chord; a modifier pair is none of those, so keyloom never writes one (K2).
    expect(kanataWrittenByKeyloom("(one-shot 2000 (multi lshift rctrl))")).toBe(false);
    expect(kanataWrittenByKeyloom("(one-shot 2000 nonexistent-key)")).toBe(false);
    expect(kanataWrittenByKeyloom("(one-shot 2000 (multi lshift rctl))")).toBe(false);
    expect(kanataWrittenByKeyloom("(caps-word-toggle 2000)")).toBe(true);
    expect(kanataWrittenByKeyloom("(caps-word-toggle 9999)")).toBe(false);
    expect(kanataWrittenByKeyloom("(one-shot 2000 (cmd rm -rf /))")).toBe(false);
    expect(kanataWrittenByKeyloom("(one-shot 2000 lshift) (cmd x)")).toBe(false);
    expect(kanataWrittenByKeyloom("(cmd rm)")).toBe(false);
  });
});

describe("nativeAction on kanata", () => {
  test("keeps its existing output for QMK and ZMK one-shots and caps word", () => {
    expect(nativeAction("qmk", "OSM(MOD_LSFT)", "here")).toBe("(one-shot 2000 lshift)");
    expect(nativeAction("zmk", "&sk LSHIFT", "here")).toBe("(one-shot 2000 lshift)");
    expect(nativeAction("qmk", "CW_TOGG", "here")).toBe("(caps-word-toggle 2000)");
  });

  test("translates a kept ZMK sticky key when the layout's kept definitions are given", () => {
    expect(nativeAction("zmk", "&sticky_key_quick_release LEFT_SHIFT", "here", kept())).toBe("(one-shot 2000 lshift)");
  });

  test("still refuses a kept sticky key it cannot see the definition of, with the same error as before", () => {
    expect(() => nativeAction("zmk", "&sticky_key_quick_release LEFT_SHIFT", "layer \"base\", position 3")).toThrow(
      "layer \"base\", position 3: the ZMK binding `&sticky_key_quick_release LEFT_SHIFT` has no kanata equivalent keyloom knows, so it can't be written",
    );
  });
});

describe("transfer of natives", () => {
  const doc = (firmware: "qmk" | "zmk" | "kanata", over: Partial<Layout> = {}): Layout => ({
    schemaVersion: 1, boardId: "x/y", firmware,
    layers: [{ id: "base", name: "Base", bindings: Array.from({ length: 6 }, (): Binding => ({ kind: "key", code: "A" })) }, { id: "nav", name: "Nav", bindings: [] }],
    macros: [], tapDances: [], combos: [], conditionalLayers: [], holdTapProfiles: [], settings: [], passthrough: [], ...over,
  });
  const handAt = (p: number) => (p < 0 ? null : p < 3 ? "left" as const : "right" as const);
  const env = (source: Layout, target: Layout, facts: TargetFacts, layers: [string, string][] = [["base", "base"]]): TransferEnv => ({
    source, target, layers: new Map(layers), handAt, fingerAt: () => "index",
    triggerPositions: () => [], targetFacts: facts,
  });
  const source = doc("zmk", { passthrough: KEPT });
  const native = (src: string, layerRefs?: Array<{ start: number; end: number; layerId: string }>): Binding => {
    const binding: Binding = { kind: "native", firmware: "zmk", source: src, label: "x" };
    return layerRefs ? { ...binding, layerRefs } : binding;
  };

  test("the one-shot shift of a ZMK layout comes across on a QMK board as its QMK one-shot, and a combo's output too", () => {
    const t = new BindingTransfer(env(source, doc("qmk"), MOONLANDER));
    const key = t.bind(native("&sticky_key_quick_release LEFT_SHIFT"), { kind: "key", code: "A" }, 0);
    expect(key).toEqual({ binding: { kind: "native", firmware: "qmk", source: "OSM(MOD_LSFT)", label: expect.any(String) } });
    const combo = t.bind(native("&sticky_key_quick_release RIGHT_SHIFT"), { kind: "none" }, -1);
    expect(combo).toMatchObject({ binding: { source: "OSM(MOD_RSFT)" } });
  });

  test("a layer hold becomes the momentary layer of the matching target layer, and the copy notes the tap it leaves out", () => {
    const t = new BindingTransfer(env(source, doc("qmk"), MOONLANDER, [["base", "base"], ["nav", "nav"]]));
    const r = t.bind(native("&magic 1 0", [{ start: 7, end: 8, layerId: "nav" }]), { kind: "none" }, 0);
    expect(r).toEqual({ binding: { kind: "layer", action: "momentary", layerId: "nav" } });
    expect(t.notes).toEqual(["x holds its layer while it is held; its tap (&rgb_ug_status_macro) is not carried"]);
  });

  test("a layer hold whose layer the target doesn't have is skipped with the layer's name", () => {
    const t = new BindingTransfer(env(source, doc("qmk"), MOONLANDER, [["base", "base"]]));
    expect(t.bind(native("&magic 1 0", [{ start: 7, end: 8, layerId: "nav" }]), { kind: "none" }, 0)).toEqual({
      skip: "it switches to the Nav layer, and the target has no layer that does the same job",
    });
  });

  test("a ZMK custom sticky key on a Glove80 put: the key and the combo both come across to the Moonlander as QMK one-shots (K1)", () => {
    const sticky = `skq: skq { compatible = "zmk,behavior-sticky-key"; #binding-cells = <1>; bindings = <&kp>; };`;
    const glove = doc("zmk", { passthrough: [pass("behavior:skq", sticky)] });
    const transfer = new BindingTransfer(env(glove, doc("qmk"), MOONLANDER));
    expect(transfer.bind(native("&skq LSHFT"), { kind: "key", code: "A" }, 0)).toMatchObject({ binding: { kind: "native", firmware: "qmk", source: "OSM(MOD_LSFT)" } });
    expect(transfer.bind(native("&skq RSHFT"), { kind: "none" }, -1)).toMatchObject({ binding: { kind: "native", firmware: "qmk", source: "OSM(MOD_RSFT)" } });
  });

  test("Bluetooth on a Moonlander is skipped with the Moonlander's reason, not the generic one", () => {
    const t = new BindingTransfer(env(source, doc("qmk"), MOONLANDER));
    expect(t.bind(native("&bt_2"), { kind: "key", code: "A" }, 0)).toEqual({ skip: "Bluetooth: Moonlander has no Bluetooth" });
  });

  test("RGB and boot keys come across to a QMK board that has lighting", () => {
    const t = new BindingTransfer(env(source, doc("qmk"), MOONLANDER));
    expect(t.bind(native("&rgb_ug RGB_TOG"), { kind: "key", code: "A" }, 0)).toEqual({ binding: { kind: "native", firmware: "qmk", source: "RGB_TOG", label: "RGB" } });
    expect(t.bind(native("&bootloader"), { kind: "key", code: "A" }, 0)).toEqual({ binding: { kind: "native", firmware: "qmk", source: "QK_BOOT", label: "Boot" } });
    expect(t.bind(native("&sys_reset"), { kind: "key", code: "A" }, 0)).toEqual({ binding: { kind: "native", firmware: "qmk", source: "QK_REBOOT", label: "Reset" } });
  });

  test("a native kept as code the reader does not know still skips with the generic reason", () => {
    const t = new BindingTransfer(env(source, doc("qmk"), MOONLANDER));
    expect(t.bind({ kind: "native", firmware: "qmk", source: "DUAL_FUNC_0", label: "DF0" }, { kind: "key", code: "A" }, 0)).toEqual({
      skip: "it is DF0, QMK code that only works on its own keyboard",
    });
  });

  test("a kanata target gets the caps word as a kanata native", () => {
    const t = new BindingTransfer(env(source, doc("kanata"), MOONLANDER));
    const r = t.bind(native("&caps_word"), { kind: "key", code: "A" }, 0);
    expect(r).toEqual({ binding: { kind: "native", firmware: "kanata", source: "(caps-word-toggle 2000)", label: "CapsW" } });
  });
});
