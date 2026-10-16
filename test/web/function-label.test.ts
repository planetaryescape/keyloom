import { describe, expect, test } from "bun:test";
import type { Layout } from "../../src/layout/schema.ts";
import { functionLabel } from "../../src/web/editor/function-label.ts";

const layout = {
  layers: [{ id: "layer-0", name: "Base", bindings: [] }, { id: "layer-4", name: "Nav", bindings: [] }],
  macros: [{ id: "oo", name: "Option twice", steps: [] }],
} as unknown as Layout;

describe("functionLabel", () => {
  test("reads like the board's legends, with layer and macro names", () => {
    expect(functionLabel("key:F17", layout)).toBe("F17");
    expect(functionLabel("key:LEFT+LCTL", layout)).toBe("⌃Left");
    expect(functionLabel("mod:LALT", layout)).toBe("Hold ⌥");
    expect(functionLabel("layer:toggle:layer-4", layout)).toBe("Toggle Nav");
    expect(functionLabel("macro:oo", layout)).toBe("Option twice");
    // A firmware-only function is said as its cap prints it, never as its source (D-270).
    expect(functionLabel("native:qmk:TD(0)", layout)).toBe("A custom key");
    expect(functionLabel("native:zmk:&layer_td", layout)).toBe("A custom key");
    expect(functionLabel("native:qmk:OSM(MOD_LSFT)", layout)).toBe("⇧ for one key");
  });
});
