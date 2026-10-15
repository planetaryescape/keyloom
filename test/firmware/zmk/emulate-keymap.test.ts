import { describe, expect, test } from "bun:test";
import { EmulateKeymapError, SETTLE_MS, mockEvents, nativeFiles, neutralise } from "../../../src/firmware/zmk/emulate-keymap.ts";
import { generateZmkSource } from "../../../src/firmware/zmk/generate.ts";
import { importZmkSource } from "../../../src/firmware/zmk/import.ts";
import { TEMPLATE_FIXTURE, glove80 } from "../../helpers/zmk.ts";

describe("neutralise", () => {
  test("replaces behaviours that need hardware with &none, along with their parameters", () => {
    const { keymap, replaced } = neutralise("bindings = <&kp A &bt BT_SEL 0 &rgb_ug RGB_COLOR_HSB(0, 100, 100) &out OUT_USB &kp B>;");
    expect(keymap).toBe("bindings = <&kp A &none &none &none &kp B>;");
    expect([...replaced]).toEqual([["bt", 1], ["rgb_ug", 1], ["out", 1]]);
  });

  test("reaches macros and hold-taps that call them, and keeps line breaks so error lines still point at the right place", () => {
    const text = "bindings\n    = <&out OUT_BLE>,\n      <&bt BT_SEL 0>;\n    other = <&kp A\n  &bootloader\n  &sys_reset &kp B>;";
    const { keymap } = neutralise(text);
    expect(keymap).toBe("bindings\n    = <&none>,\n      <&none>;\n    other = <&kp A\n  &none\n  &none &kp B>;");
  });

  test("leaves alone what merely starts with a replaced name, includes and numbers", () => {
    const text = "#include <dt-bindings/zmk/bt.h>\n#include <behaviors.dtsi>\nbindings = <&bt_0 &out_x &rgb_ug_status_macro &kp B>;\ntapping-term-ms = <200>;\nkey-positions = <1 2>;";
    const { keymap, replaced } = neutralise(text);
    expect(keymap).toBe(text);
    expect(replaced.size).toBe(0);
  });
});

describe("mockEvents", () => {
  test("starts with an unmapped event, gives each event the gap to the next less one tick, and the last one the settle time", () => {
    const events = [
      { at: 0, position: 3, action: "press" as const },
      { at: 100, position: 3, action: "release" as const },
      { at: 100, position: 4, action: "press" as const },
      { at: 101, position: 4, action: "release" as const },
    ];
    expect(mockEvents(events, 42)).toEqual([
      "ZMK_MOCK_RELEASE(0,42,10)",
      "ZMK_MOCK_PRESS(0,3,99)",
      "ZMK_MOCK_RELEASE(0,3,0)",
      "ZMK_MOCK_PRESS(0,4,0)",
      `ZMK_MOCK_RELEASE(0,4,${SETTLE_MS})`,
    ]);
  });

  test("a wait longer than the mock can count, or events out of order, are refused", () => {
    expect(() => mockEvents([{ at: 0, position: 0, action: "press" }, { at: 40_000, position: 0, action: "release" }], 10)).toThrow(/longest wait is 32767 ms/);
    expect(() => mockEvents([{ at: 50, position: 0, action: "press" }, { at: 10, position: 0, action: "release" }], 10)).toThrow(/time order/);
  });
});

describe("nativeFiles", () => {
  const events = [{ at: 0, position: 1, action: "press" as const }, { at: 40, position: 1, action: "release" as const }];
  const base = { keymap: "/ { keymap { compatible = \"zmk,keymap\"; l { bindings = <&kp A &bt BT_CLR &kp B>; }; }; };\n", conf: "", keyCount: 3, events };

  test("appends a mock keyboard with one column per position and an identity matrix, after the layout's own keymap", () => {
    const { keymap } = nativeFiles(base);
    expect(keymap.startsWith("/ { keymap {")).toBe(true);
    expect(keymap).toContain("map = <RC(0,0) RC(0,1) RC(0,2)>;");
    expect(keymap).toContain("zmk,matrix-transform = &keyloom_emulate_transform;");
    expect(keymap).toContain("&kscan {");
    expect(keymap).toContain("ZMK_MOCK_PRESS(0,1,39)");
    expect(keymap).toContain("&kp A &none &kp B");
  });

  test("says what it replaced, in plain words", () => {
    expect(nativeFiles(base).warnings).toEqual(["1 binding uses &bt (Bluetooth), which can't run on a computer; it was replaced with &none."]);
  });

  test("keeps the settings that change what keys do, lists the rest as left out, and notices NKRO", () => {
    const r = nativeFiles({ ...base, conf: "# generated\nCONFIG_ZMK_HID_REPORT_TYPE_NKRO=y\nCONFIG_ZMK_COMBO_MAX_COMBOS_PER_KEY=6\nCONFIG_ZMK_SLEEP=y\nCONFIG_BT_CTLR_TX_PWR_PLUS_8=y\n" });
    expect(r.conf).toBe("CONFIG_ZMK_HID_REPORT_TYPE_NKRO=y\nCONFIG_ZMK_COMBO_MAX_COMBOS_PER_KEY=6\n");
    expect(r.nkro).toBe(true);
    expect(r.warnings.at(-1)).toBe(
      "2 settings weren't applied, because the emulator applies only the ones that change what keys do (combos, macros, report type): CONFIG_ZMK_SLEEP, CONFIG_BT_CTLR_TX_PWR_PLUS_8.",
    );
    expect(nativeFiles(base).nkro).toBe(false);
  });

  test("refuses events for keys the board doesn't have, and no events at all", () => {
    expect(() => nativeFiles({ ...base, events: [{ at: 0, position: 3, action: "press" }] })).toThrow(/key 4 doesn't exist; the board has keys 1 to 3/);
    expect(() => nativeFiles({ ...base, events: [] })).toThrow(EmulateKeymapError);
  });

  test("the Glove80 template's generated keymap comes out with every Bluetooth, RGB and reset binding replaced", async () => {
    const board = await glove80();
    const { layout } = await importZmkSource(TEMPLATE_FIXTURE, board.definition);
    const source = generateZmkSource({ layout, board: board.definition, geometry: board.geometry, revisionId: "rev_test" });
    const r = nativeFiles({ keymap: source.files[0]?.content as string, conf: source.files[1]?.content as string, keyCount: 80, events });
    expect(r.keymap).not.toMatch(/&(bt|out|rgb_ug|bootloader|sys_reset)\b(?!_)/);
    expect(r.keymap).toContain("map = <RC(0,0) RC(0,1)");
    expect(r.keymap).toContain("RC(0,79)>;");
    expect(r.warnings.map((w) => w.split(" (")[0]?.replace(/^\d+ bindings? uses? /, ""))).toEqual(expect.arrayContaining(["&rgb_ug", "&out", "&bt", "&bootloader", "&sys_reset"]));
  });
});
