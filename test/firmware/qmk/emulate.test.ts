import { describe, expect, test } from "bun:test";
import { carriedRules, harnessFiles, harnessName, harnessScript, rulesWithDefaults } from "../../../src/firmware/qmk/emulate-harness.ts";
import { parseHarnessOutput, typedText } from "../../../src/firmware/qmk/emulate-reports.ts";
import { failureMessage, scriptFor } from "../../../src/firmware/qmk/emulate.ts";

describe("reading the harness output", () => {
  test("turns a hold-and-tap into a modifier report and the key report on top of it", () => {
    const { reports, warnings } = parseHarnessOutput(["K 0 00 KC_A", "K 40 00", "K 360 04", "K 360 04 KC_U", "K 360 04", "K 500 00"].join("\n"));
    expect(reports).toEqual([
      { at: 0, kind: "keyboard", mods: [], keys: ["A"] },
      { at: 40, kind: "keyboard", mods: [], keys: [] },
      { at: 360, kind: "keyboard", mods: ["LALT"], keys: [] },
      { at: 360, kind: "keyboard", mods: ["LALT"], keys: ["U"] },
      { at: 360, kind: "keyboard", mods: ["LALT"], keys: [] },
      { at: 500, kind: "keyboard", mods: [], keys: [] },
    ]);
    expect(warnings).toEqual([]);
  });

  test("names every modifier bit in HID order", () => {
    const { reports } = parseHarnessOutput("K 0 ff KC_A");
    expect(reports[0]).toMatchObject({ mods: ["LCTL", "LSFT", "LALT", "LGUI", "RCTL", "RSFT", "RALT", "RGUI"] });
  });

  test("resolves QMK aliases to keyloom's names and drops a report that repeats the one before", () => {
    const { reports } = parseHarnessOutput("K 0 00 KC_ENT KC_BSPC\nK 1 00 KC_BSPC KC_ENTER\nK 2 00");
    expect(reports).toEqual([
      { at: 0, kind: "keyboard", mods: [], keys: ["BACKSPACE", "ENTER"] },
      { at: 2, kind: "keyboard", mods: [], keys: [] },
    ]);
  });

  test("an empty report at the start is not news", () => {
    expect(parseHarnessOutput("K 5 00").reports).toEqual([]);
  });

  test("consumer reports are named by the media key and end with an empty usage", () => {
    const { reports } = parseHarnessOutput("C 10 KC_VOLU\nC 20 usage-0000");
    expect(reports).toEqual([
      { at: 10, kind: "consumer", usages: ["AUDIO_VOL_UP"] },
      { at: 20, kind: "consumer", usages: [] },
    ]);
  });

  test("says so when a key has no keyloom name or the layout moved the mouse", () => {
    const { reports, warnings } = parseHarnessOutput("K 0 00 KC_FANCY\nM 5 01");
    expect(reports[0]).toMatchObject({ keys: ["KC_FANCY"] });
    expect(warnings).toEqual(["keys keyloom has no name for are shown by QMK's name: KC_FANCY", "mouse button and movement reports are not shown"]);
  });

  test("ignores lines that are not reports", () => {
    expect(parseHarnessOutput("[ RUN ] Emulate.Run\n\nK 0 00 KC_A\n").reports).toHaveLength(1);
  });
});

describe("what a text field would show", () => {
  const press = (mods: string[], ...keys: string[]) => ({ at: 0, kind: "keyboard" as const, mods, keys });
  test("types letters, shifted letters and symbols, and Backspace deletes", () => {
    expect(
      typedText([
        press([], "H"), press([]), press(["LSFT"], "I"), press(["LSFT"]), press(["LSFT"], "N1"), press([]),
        press([], "BACKSPACE"), press([], "MINUS"),
      ]),
    ).toBe("hI-");
  });

  test("a key held across reports types once, and a shortcut types nothing", () => {
    expect(typedText([press([], "A"), press([], "A", "B"), press(["LGUI"], "C"), press(["LALT"], "V")])).toBe("ab");
  });

  test("Caps Lock flips letters but not symbols", () => {
    expect(typedText([press([], "CAPS_LOCK"), press([], "A"), press([], "N1")])).toBe("A1");
  });
});

describe("the script", () => {
  test("starts at time zero, keeps same-time events in order and sorts the rest", () => {
    const script = scriptFor(
      [
        { at: 1100, position: 5, action: "release" },
        { at: 1000, position: 5, action: "press" },
        { at: 1000, position: 7, action: "press" },
      ],
      72,
    );
    expect(script).toBe("0 5 press\n0 7 press\n100 5 release\n");
  });

  test("a lead puts quiet time before the first event, so QMK's clock is not at zero when a key goes down (the typing lab asks for it)", () => {
    expect(scriptFor([{ at: 5, position: 5, action: "press" }, { at: 45, position: 5, action: "release" }], 72, 100)).toBe("100 5 press\n140 5 release\n");
  });

  test("rejects an empty script, a position off the board and a negative time", () => {
    expect(() => scriptFor([], 72)).toThrow("no key events");
    expect(() => scriptFor([{ at: 0, position: 72, action: "press" }], 72)).toThrow("position 72 is not a key on this board (0 to 71)");
    expect(() => scriptFor([{ at: -1, position: 0, action: "press" }], 72)).toThrow("must be zero or more");
  });
});

describe("the harness files", () => {
  test("rules.mk keeps the features that change what keys send and reports the rest", () => {
    const split = carriedRules("CONSOLE_ENABLE = no\nORYX_ENABLE = yes\nTAP_DANCE_ENABLE = yes\n# note\nCOMBO_ENABLE = yes # on\nSRC += extra.c\n");
    expect(split.carried).toBe("TAP_DANCE_ENABLE = yes\nCOMBO_ENABLE = yes\n");
    expect(split.dropped).toEqual(["ORYX_ENABLE = yes", "SRC += extra.c"]);
    expect(carriedRules(undefined)).toEqual({ carried: "", dropped: [] });
  });

  test("mouse keys and media keys are on unless the layout turns them off", () => {
    expect(rulesWithDefaults("")).toBe("EXTRAKEY_ENABLE = yes\nMOUSEKEY_ENABLE = yes\n");
    expect(rulesWithDefaults("MOUSEKEY_ENABLE = no\n")).toBe("EXTRAKEY_ENABLE = yes\nMOUSEKEY_ENABLE = no\n");
  });

  test("a harness name is a valid QMK test name", () => {
    expect(harnessName("zsa/moonlander/reva", "k3f9")).toBe("keyloom_emu_zsa_moonlander_reva_k3f9");
    expect(harnessName("foostan/corne-v4", "a")).not.toContain("-");
  });

  test("the keymap and config go in as generated, and the probe uses the board's own layout macro in position order", () => {
    const files = harnessFiles(
      {
        name: "keyloom_emu_x", keymapFiles: [{ path: "keymap.c", content: "KEYMAP" }, { path: "config.h", content: "#define TAPPING_TERM 175\n" }],
        layoutMacro: "LAYOUT_moonlander", keyCount: 3, zsa: true, modules: ["zsa/defaults"], qmkTarget: "zsa/moonlander/reva",
      },
      "COMBO_ENABLE = yes\n",
    );
    const byPath = (p: string) => files.find((f) => f.path === p)?.content ?? "";
    expect(byPath("keymap.c")).toBe("KEYMAP");
    expect(byPath("user_config.h")).toBe("#define TAPPING_TERM 175\n");
    expect(byPath("stubs.c")).toContain("LAYOUT_moonlander(1,2,3)");
    expect(byPath("keyloom_board.h")).toContain("zsa/defaults/defaults.h");
    expect(byPath("version.h")).toContain('#define QMK_KEYBOARD "zsa/moonlander/reva"');
    expect(byPath("version.h")).toContain('#define QMK_KEYMAP "keyloom"');
    expect(byPath("keyloom_board.h")).toContain("#define WEBUSB_PAIR KC_NO");
    expect(byPath("test.mk")).toContain("COMBO_ENABLE = yes\nSRC += tests/keyloom_emu_x/stubs.c");
  });

  test("a board that is not ZSA's gets no Oryx stand-ins", () => {
    const files = harnessFiles({ name: "n", keymapFiles: [], layoutMacro: "LAYOUT", keyCount: 1, zsa: false, modules: [], qmkTarget: "x/y" }, "");
    expect(files.find((f) => f.path === "keyloom_board.h")?.content).not.toContain("rgb_matrix");
    expect(files.find((f) => f.path === "stubs.c")?.content).not.toContain("rgb_matrix");
  });

  test("the script asks qmk for the board's layout and config, then runs QMK's own test target", () => {
    const script = harnessScript("keyloom_emu_x", "zsa/moonlander/reva");
    expect(script).toContain("qmk generate-keyboard-h -kb zsa/moonlander/reva");
    expect(script).toContain("qmk generate-config-h -kb zsa/moonlander/reva");
    expect(script).toContain("make -j4 test:keyloom_emu_x");
    // The result comes back on stdout, between markers.
    expect(script.indexOf("make -j4")).toBeLessThan(script.indexOf("cat $D/out.txt"));
  });
});

describe("when the harness fails", () => {
  const board = { keyCount: 72 } as never;
  test("a symbol that only exists on the keyboard says so", () => {
    const log = ["/usr/bin/ld: keymap.o: in function `process_record_user':", "keymap.c:(.text+0x20): undefined reference to `oled_write'"];
    expect(failureMessage(log, "n", "", board)).toBe("The emulator can't link the generated keymap: it uses `oled_write`, which only exists on the keyboard itself.");
  });

  test("anything else shows the first error line", () => {
    expect(failureMessage(["Making test n", "make[1]: *** [Makefile:1: x] Error 1"], "n", "", board)).toBe("QMK's test harness failed: make[1]: *** [Makefile:1: x] Error 1");
  });
});
