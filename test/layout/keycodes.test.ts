import { describe, expect, test } from "bun:test";
import {
  KEYCODES, fromQmk, fromQmkShifted, fromZmk, fromZmkShifted, isKeyCode, keyCodeInfo, keyCodeLabel, qmkName, zmkName,
} from "../../src/layout/keycodes.ts";

describe("keycode table", () => {
  test("names, QMK names and ZMK names are unique, so lookups are unambiguous", () => {
    const names = KEYCODES.map((k) => k.name);
    expect(new Set(names).size).toBe(names.length);
    const qmk = KEYCODES.flatMap((k) => k.qmk);
    expect(new Set(qmk).size).toBe(qmk.length);
    const zmk = KEYCODES.flatMap((k) => k.zmk);
    expect(new Set(zmk).size).toBe(zmk.length);
  });

  test("covers the keys named in the blueprint", () => {
    for (const n of ["A", "Z", "N0", "N9", "ENTER", "TAB", "SPACE", "MINUS", "F1", "F24", "LEFT"]) expect(isKeyCode(n)).toBe(true);
  });

  test("QMK aliases and ZMK names resolve to the same keyloom key", () => {
    expect(fromQmk("KC_ESC")?.name).toBe("ESCAPE");
    expect(fromQmk("KC_ESCAPE")?.name).toBe("ESCAPE");
    expect(fromZmk("ESC")?.name).toBe("ESCAPE");
    expect(fromZmk("ESCAPE")?.name).toBe("ESCAPE");
    expect(fromQmk("KC_1")?.name).toBe("N1");
    expect(fromZmk("N1")?.name).toBe("N1");
    expect(fromZmk("NUMBER_1")?.name).toBe("N1");
    expect(fromQmk("KC_LBRC")?.name).toBe("LEFT_BRACKET");
    expect(fromZmk("LBKT")?.name).toBe("LEFT_BRACKET");
    expect(fromQmk("KC_AUDIO_VOL_UP")?.name).toBe("AUDIO_VOL_UP");
    expect(fromZmk("C_VOL_UP")?.name).toBe("AUDIO_VOL_UP");
  });

  test("lookups go both ways", () => {
    for (const k of KEYCODES) {
      expect(qmkName(k.name)).toBe(k.qmk[0] as string);
      expect(zmkName(k.name)).toBe(k.zmk[0] as string);
      expect(fromQmk(qmkName(k.name))?.name).toBe(k.name);
      expect(fromZmk(zmkName(k.name))?.name).toBe(k.name);
      expect(keyCodeInfo(k.name)).toBe(k);
    }
  });

  test("QMK shifted aliases are the base key plus Left Shift", () => {
    expect(fromQmkShifted("KC_EXLM")).toMatchObject({ code: "N1", mods: ["LSFT"] });
    expect(fromQmkShifted("KC_EXCLAIM")).toMatchObject({ code: "N1", mods: ["LSFT"] });
    expect(fromQmkShifted("KC_LCBR")).toMatchObject({ code: "LEFT_BRACKET", mods: ["LSFT"] });
    expect(fromQmkShifted("KC_TILD")).toMatchObject({ code: "GRAVE", mods: ["LSFT"] });
    expect(fromQmkShifted("KC_PIPE")).toMatchObject({ code: "BACKSLASH", mods: ["LSFT"] });
    expect(fromQmkShifted("KC_A")).toBeUndefined();
    // the same symbols in ZMK's names
    expect(fromZmkShifted("EXCLAMATION")).toMatchObject({ code: "N1", mods: ["LSFT"] });
    expect(fromZmkShifted("LBRC")).toMatchObject({ code: "LEFT_BRACKET", mods: ["LSFT"] });
    // shifted symbols are not keys of their own
    expect(fromQmk("KC_EXLM")).toBeUndefined();
    expect(isKeyCode("EXLM")).toBe(false);
  });

  test("every shifted alias has a base key in the table", () => {
    for (const name of ["KC_AT", "KC_HASH", "KC_DLR", "KC_PERC", "KC_CIRC", "KC_AMPR", "KC_ASTR", "KC_LPRN", "KC_RPRN", "KC_UNDS", "KC_PLUS", "KC_RCBR", "KC_COLN", "KC_DQUO", "KC_LABK", "KC_RABK", "KC_QUES"]) {
      const s = fromQmkShifted(name);
      expect(s).toBeDefined();
      expect(isKeyCode(s?.code)).toBe(true);
    }
  });

  test("names on only one firmware are not keycodes", () => {
    expect(fromQmk("KC_MS_BTN1")).toBeUndefined(); // QMK mouse keys: ZMK has no keyboard-page equivalent
    expect(fromQmk("QK_BOOT")).toBeUndefined();
    expect(fromQmk("KC_HYPR")).toBeUndefined();
    expect(fromQmk("KC_TRNS")).toBeUndefined();
    expect(fromZmk("BT_CLR")).toBeUndefined();
    expect(fromZmk("C_AL_SPELLCHECK")).toBeUndefined();
  });

  test("isKeyCode rejects aliases, wrong types and prototype keys", () => {
    expect(isKeyCode("ESC")).toBe(false); // an alias, not the canonical name
    expect(isKeyCode("KC_A")).toBe(false);
    expect(isKeyCode("")).toBe(false);
    for (const bad of [undefined, null, 1, {}, [], { name: "A" }, ["A"]]) expect(isKeyCode(bad)).toBe(false);
    for (const proto of ["constructor", "__proto__", "toString", "hasOwnProperty", "prototype"]) {
      expect(isKeyCode(proto)).toBe(false);
      expect(fromQmk(proto)).toBeUndefined();
      expect(fromZmk(proto)).toBeUndefined();
      expect(fromQmkShifted(proto)).toBeUndefined();
      expect(keyCodeLabel(proto)).toBe(proto);
    }
  });

  test("qmkBasic: every key in the shared set fits a mod-tap's 8-bit tap side", () => {
    // The set is the intersection with ZMK, and QMK's media keys sit below 0xFF, so none is excluded today.
    expect(KEYCODES.every((k) => k.qmkBasic)).toBe(true);
  });

  test("labels", () => {
    expect(keyCodeLabel("A")).toBe("A");
    expect(keyCodeLabel("LEFT_CTRL")).toBe("Left Control");
    expect(keyCodeLabel("NOT_A_KEY")).toBe("NOT_A_KEY");
  });
});
