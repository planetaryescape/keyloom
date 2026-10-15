import { describe, expect, test } from "bun:test";
import { typedText } from "../../../src/firmware/emulate/text.ts";
import type { EmulatorReport } from "../../../src/firmware/emulate/types.ts";

const kb = (mods: string[], keys: string[], at = 0): EmulatorReport => ({ at, kind: "keyboard", mods, keys });

describe("typedText", () => {
  test("a key typed is a key that wasn't in the previous report; holding it types once", () => {
    expect(typedText([kb([], ["H"]), kb([], ["H", "I"]), kb([], ["I"]), kb([], [])])).toBe("hi");
  });

  test("Shift gives capitals and the shifted symbol", () => {
    expect(typedText([kb(["LSFT"], ["A"]), kb(["LSFT"], []), kb(["RSFT"], ["N1"]), kb([], [])])).toBe("A!");
  });

  test("Caps Lock flips the case of letters but not of symbols", () => {
    expect(typedText([kb([], ["CAPS_LOCK"]), kb([], []), kb([], ["A"]), kb([], []), kb([], ["N1"])])).toBe("A1");
  });

  test("Backspace removes the last character; Enter and Tab type themselves", () => {
    expect(typedText([kb([], ["A"]), kb([], []), kb([], ["B"]), kb([], []), kb([], ["BACKSPACE"]), kb([], []), kb([], ["ENTER"]), kb([], []), kb([], ["TAB"])])).toBe("a\n\t");
  });

  test("a shortcut types nothing, and consumer reports are ignored", () => {
    const reports: EmulatorReport[] = [kb(["LGUI"], ["C"]), kb([], []), { at: 0, kind: "consumer", usages: ["AUDIO_VOL_UP"] }, kb([], ["KP_1"])];
    expect(typedText(reports)).toBe("1");
  });
});
