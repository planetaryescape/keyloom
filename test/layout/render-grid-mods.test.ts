import { describe, expect, test } from "bun:test";
import { modsText } from "../../src/layout/render-grid.ts";

describe("modsText", () => {
  test("names the left-hand sets and writes one r in front of an all-right-hand set", () => {
    expect(modsText(["LCTL", "LSFT", "LALT", "LGUI"])).toBe("Hyp");
    expect(modsText(["RCTL", "RSFT", "RALT", "RGUI"])).toBe("rHyp");
    expect(modsText(["RCTL", "RSFT", "RALT"])).toBe("rMeh");
    expect(modsText(["RGUI", "RSFT"])).toBe("r⌘⇧");
    expect(modsText(["RALT"])).toBe("r⌥");
    expect(modsText(["LGUI", "RSFT"])).toBe("⌘r⇧");
  });
});
