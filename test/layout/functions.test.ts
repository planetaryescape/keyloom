import { describe, expect, test } from "bun:test";
import { bindingFunctions, describeBinding } from "../../src/layout/functions.ts";

describe("bindingFunctions", () => {
  test("canonical strings from 02", () => {
    expect(bindingFunctions({ kind: "key", code: "N1", mods: ["LSFT"] })).toEqual(["key:N1+LSFT"]);
    expect(bindingFunctions({ kind: "key", code: "A" })).toEqual(["key:A"]);
    expect(bindingFunctions({ kind: "modifier", mods: ["LALT"] })).toEqual(["mod:LALT"]);
    expect(bindingFunctions({ kind: "layer", action: "momentary", layerId: "num" })).toEqual(["layer:momentary:num"]);
    expect(bindingFunctions({ kind: "layer", action: "toggle", layerId: "num" })).toEqual(["layer:toggle:num"]);
    expect(bindingFunctions({ kind: "macro", macroId: "opt-opt" })).toEqual(["macro:opt-opt"]);
  });

  test("a hold-tap is two functions, tap then hold", () => {
    expect(bindingFunctions({ kind: "holdTap", tap: { code: "F" }, hold: { mods: ["LGUI"] }, profileId: "p" })).toEqual(["key:F", "mod:LGUI"]);
    expect(bindingFunctions({ kind: "holdTap", tap: { code: "SPACE" }, hold: { layerId: "nav" }, profileId: "p" })).toEqual(["key:SPACE", "layer:momentary:nav"]);
  });

  test("modifiers are written in one order whatever order they were given", () => {
    const a = bindingFunctions({ kind: "modifier", mods: ["LGUI", "LCTL", "LALT", "LSFT"] });
    const b = bindingFunctions({ kind: "modifier", mods: ["LSFT", "LALT", "LCTL", "LGUI"] });
    expect(a).toEqual(["mod:LCTL+LSFT+LALT+LGUI"]);
    expect(b).toEqual(a);
  });

  test("transparent and none produce nothing; native names its source", () => {
    expect(bindingFunctions({ kind: "transparent" })).toEqual([]);
    expect(bindingFunctions({ kind: "none" })).toEqual([]);
    expect(bindingFunctions({ kind: "native", firmware: "qmk", source: "TD(DANCE_0)", label: "TD0" })).toEqual(["native:qmk:TD(DANCE_0)"]);
    expect(describeBinding({ kind: "transparent" })).toBe("transparent");
    expect(describeBinding({ kind: "holdTap", tap: { code: "F" }, hold: { mods: ["LGUI"] }, profileId: "p" })).toBe("key:F / mod:LGUI");
  });
});
