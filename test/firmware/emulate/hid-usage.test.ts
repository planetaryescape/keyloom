import { describe, expect, test } from "bun:test";
import { consumerUsageName, knownConsumerNames, knownKeyboardNames, keyboardKeyName, modsOf } from "../../../src/firmware/emulate/hid-usage.ts";
import { isKeyCode } from "../../../src/layout/keycodes.ts";

describe("HID usage names", () => {
  test("every name the table gives is one of keyloom's key codes, so a report compares with the layout", () => {
    for (const name of [...knownKeyboardNames(), ...knownConsumerNames()]) expect(isKeyCode(name)).toBe(true);
  });

  test("the usages the tests rely on (HID usage tables: A is 0x04, Enter 0x28, Left Shift 0xE1, volume up 0xE9)", () => {
    expect(keyboardKeyName(0x04)).toBe("A");
    expect(keyboardKeyName(0x1d)).toBe("Z");
    expect(keyboardKeyName(0x1e)).toBe("N1");
    expect(keyboardKeyName(0x27)).toBe("N0");
    expect(keyboardKeyName(0x28)).toBe("ENTER");
    expect(keyboardKeyName(0x2a)).toBe("BACKSPACE");
    expect(keyboardKeyName(0x3a)).toBe("F1");
    expect(keyboardKeyName(0x68)).toBe("F13");
    expect(keyboardKeyName(0x73)).toBe("F24");
    expect(keyboardKeyName(0x50)).toBe("LEFT");
    expect(keyboardKeyName(0xe1)).toBe("LEFT_SHIFT");
    expect(consumerUsageName(0xe9)).toBe("AUDIO_VOL_UP");
    expect(consumerUsageName(0xcd)).toBe("MEDIA_PLAY_PAUSE");
  });

  test("a usage keyloom has no name for keeps its number", () => {
    expect(keyboardKeyName(0xf0)).toBe("KEY_0xF0");
    expect(consumerUsageName(0x1a3)).toBe("CONSUMER_0x1A3");
  });

  test("the modifier byte reads low bit first: Control, Shift, Alt, GUI, then the right-hand four", () => {
    expect(modsOf(0)).toEqual([]);
    expect(modsOf(0b0000_0010)).toEqual(["LSFT"]);
    expect(modsOf(0b0101_0001)).toEqual(["LCTL", "RCTL", "RALT"]);
    expect(modsOf(0xff)).toEqual(["LCTL", "LSFT", "LALT", "LGUI", "RCTL", "RSFT", "RALT", "RGUI"]);
  });
});
