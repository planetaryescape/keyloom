import { describe, expect, test } from "bun:test";
import { layerLight, reachedLayer, reachKey } from "../../src/web/light/layer-light.ts";
import { reachWords } from "../../src/web/light/reach-words.ts";
import { frontMode, frontWords } from "../../src/web/keyboard/front-words.ts";
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

describe("front print words (D-267, P1 review)", () => {
  test("a lone modifier is spelled out, with its symbol when the board's caps carry symbols and as the word alone when not", () => {
    expect(frontWords("⌥", "both")).toBe("⌥ option");
    expect(frontWords("⌘", "both")).toBe("⌘ command");
    expect(frontWords("✦", "both")).toBe("✦ hyper");
    expect(frontWords("⌘", "word")).toBe("command");
    expect(frontWords("⌃", "word")).toBe("control");
    expect(frontWords("⌘", "mark")).toBe("⌘");
  });

  test("anything else is printed as it is", () => {
    expect(frontWords("⇧⌘", "both")).toBe("⇧⌘");
    expect(frontWords("NAV", "word")).toBe("NAV");
  });

  test("one choice for the whole board: symbols when the widest print fits a 1u cap's front, measured", () => {
    // Measured in Instrument Sans at 11 px, 75% width: "⌘ command" is 50.5 px. A Moonlander cap at 57 px has 51.9 px of front.
    expect(frontMode(57, { both: 50.5, word: 38.8 }, 0.09)).toBe("both");
    expect(frontMode(49, { both: 50.5, word: 38.8 }, 0.09)).toBe("word");
    // BK's 1280x577 window with a mouse: 38 px keys, where even "command" (35 px at 10 px) doesn't fit 34.6 px.
    expect(frontMode(38, { both: 45.9, word: 35.3 }, 0.09)).toBe("mark");
  });

  test("without a measurement the estimate decides, and it errs toward the word alone", () => {
    expect(frontMode(49, null, 0.09)).not.toBe("both");
  });
});
