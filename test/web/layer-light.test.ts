import { describe, expect, test } from "bun:test";
import { layerLight, reachedLayer, reachKey } from "../../src/web/light/layer-light.ts";
import { reachWords } from "../../src/web/light/reach-words.ts";
import { frontWords } from "../../src/web/keyboard/front-words.ts";
import type { Binding, Layer } from "../../src/layout/schema.ts";

const layer = (id: string, bindings: Binding[], extra: Partial<Layer> = {}): Layer => ({ id, name: id, bindings, ...extra });
const k = (code: string): Binding => ({ kind: "key", code });

describe("a layer's light (D-263)", () => {
  test("the first layer with no LEDs and no chosen colour is unlit", () => {
    expect(layerLight([layer("base", [k("A")])], 0, 1)).toBeNull();
  });

  test("a layer's LEDs give its light: the colour most keys show, not a lone accent", () => {
    const lit = layer("nav", [k("A"), k("B"), k("C")], { lighting: { keys: { "0": [0, 255, 255], "1": [0, 255, 255], "2": [170, 255, 255] } } });
    expect(layerLight([layer("base", []), lit], 1, 3)).toBe("#ff0000");
  });

  test("dark LEDs don't count, and a layer with only dark ones falls back to its place's colour", () => {
    const dark = layer("x", [k("A")], { lighting: { layer: [0, 0, 0] } });
    expect(layerLight([layer("base", []), dark], 1, 1)).toBe("var(--layer-2)");
  });

  test("a chosen colour lights even the first layer", () => {
    expect(layerLight([layer("base", [], { color: 4 })], 0, 0)).toBe("var(--layer-4)");
  });
});

describe("which key reaches a layer", () => {
  const base = layer("base", [
    { kind: "layer", action: "to", layerId: "sym" },
    { kind: "holdTap", tap: { code: "TAB" }, hold: { layerId: "sym" }, profileId: "p" },
    { kind: "holdTap", tap: { code: "SPACE" }, hold: { layerId: "sym" }, profileId: "p" },
  ]);
  const layout = { layers: [base, layer("sym", [k("A"), k("B"), k("C")])], tapDances: [] };

  test("reachedLayer reads layer keys and layer holds", () => {
    expect(reachedLayer(base.bindings[0], layout)).toBe("sym");
    expect(reachedLayer(base.bindings[1], layout)).toBe("sym");
    expect(reachedLayer(k("A"), layout)).toBeNull();
  });

  test("a held thumb key wins over a held key elsewhere and over a go-to key", () => {
    expect(reachKey(layout, "sym", new Set([2]))).toBe(2);
    expect(reachKey(layout, "sym", new Set())).toBe(1);
  });

  test("the caption says it in words, with the key apart so it can be drawn as a keycap", () => {
    const words = reachWords(layout, 1, { "2": "left-thumb" }, (p) => ["Sym", "⇥", "Space"][p] ?? "");
    expect(words).toEqual({ before: "Hold", key: "Space", after: " on the left thumb" });
    expect(reachWords(layout, 0, {}, () => "")).toEqual({ before: "Your first layer", key: null, after: "" });
  });
});

describe("front print words (D-267)", () => {
  test("a lone modifier is spelled out when it fits, shortened when it doesn't, and either side reads the same", () => {
    expect(frontWords("⌥", 1, 72)).toBe("⌥ option");
    expect(frontWords("r⌥", 1, 72)).toBe("⌥ option");
    expect(frontWords("⌘", 1, 49)).toBe("⌘ cmd");
  });

  test("anything else is printed as it is", () => {
    expect(frontWords("⇧⌘", 1, 72)).toBe("⇧⌘");
    expect(frontWords("NAV", 1, 72)).toBe("NAV");
  });
});
