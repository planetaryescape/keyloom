import { describe, expect, test } from "bun:test";
import { matchLayers } from "../../src/layout/layer-match.ts";
import type { Binding, Layer, Layout } from "../../src/layout/schema.ts";

const key = (code: string): Binding => ({ kind: "key", code });
const layer = (id: string, name: string, codes: string[]): Layer => ({ id, name, bindings: codes.map(key) });
const doc = (...layers: Layer[]): Layout => ({ schemaVersion: 1, boardId: "x/y", firmware: "qmk", layers, macros: [], tapDances: [], combos: [], holdTapProfiles: [], settings: [], passthrough: [] });

describe("matchLayers", () => {
  test("the base layer is the base layer whatever it is called", () => {
    const m = matchLayers(doc(layer("a", "Layer 0", ["A"])), doc(layer("b", "default_layer", ["Q"])));
    expect(m[0]).toMatchObject({ targetLayerId: "b", method: "role", score: 1 });
  });

  test("layers with the same name pair, even when their order differs", () => {
    const source = doc(layer("a", "Base", ["A"]), layer("n", "Numbers", ["N1", "N2"]), layer("s", "Symbols", ["MINUS"]));
    const target = doc(layer("b", "base", ["A"]), layer("s2", "symbols", ["MINUS"]), layer("n2", "numbers", ["N1", "N2"]));
    const m = matchLayers(source, target);
    expect(m.map((x) => x.targetLayerId)).toEqual(["b", "n2", "s2"]);
    expect(m[1]?.method).toBe("name");
  });

  test("Navigation and navigate share a stem", () => {
    const m = matchLayers(doc(layer("a", "A", ["A"]), layer("nav", "Navigation", ["LEFT"])), doc(layer("b", "B", ["B"]), layer("nv", "navigate", ["DOWN"])));
    expect(m[1]).toMatchObject({ targetLayerId: "nv", method: "similar-name" });
  });

  test("Layer 4 and Layer 5 are not the same layer just because both are called Layer", () => {
    const m = matchLayers(doc(layer("a", "Base", ["A"]), layer("l4", "Layer 4", ["F1"])), doc(layer("b", "Base", ["A"]), layer("l5", "Layer 5", ["F9"])));
    expect(m[1]?.targetLayerId).toBeNull();
    expect(m[1]?.signals.name).toBe(0);
  });

  test("a differently named layer that does the same things is matched by function overlap, with its score", () => {
    const m = matchLayers(
      doc(layer("a", "Base", ["A"]), layer("x", "Arrows", ["LEFT", "DOWN", "UP", "RIGHT", "HOME"])),
      doc(layer("b", "Base", ["A"]), layer("y", "Cursor", ["LEFT", "DOWN", "UP", "RIGHT", "END"])),
    );
    expect(m[1]).toMatchObject({ targetLayerId: "y", method: "function-overlap" });
    expect(m[1]?.score).toBeCloseTo(4 / 6, 2);
  });

  test("two source layers never claim the same target layer; the better match wins", () => {
    const source = doc(layer("a", "Base", ["A"]), layer("one", "Nav", ["LEFT", "RIGHT"]), layer("two", "Nav2", ["LEFT", "RIGHT", "UP"]));
    const target = doc(layer("b", "Base", ["A"]), layer("nav", "Nav", ["LEFT", "RIGHT", "UP"]));
    const m = matchLayers(source, target);
    expect(m.filter((x) => x.targetLayerId === "nav")).toHaveLength(1);
    expect(m[1]?.targetLayerId).toBe("nav");
    expect(m[2]?.targetLayerId).toBeNull();
  });

  test("a layer with nothing in common matches nothing, and says how close it came", () => {
    const m = matchLayers(doc(layer("a", "Base", ["A"]), layer("f", "Function", ["F1", "F2", "F3"])), doc(layer("b", "Base", ["A"]), layer("g", "Gaming", ["W", "S", "D"])));
    expect(m[1]).toMatchObject({ targetLayerId: null, method: null, score: 0 });
  });

  test("the result does not depend on the order of the target's layers beyond the base", () => {
    const source = doc(layer("a", "Base", ["A"]), layer("n", "Nav", ["LEFT", "RIGHT"]), layer("m", "Media", ["PLAY", "PAUSE"]));
    const t1 = doc(layer("b", "Base", ["A"]), layer("nv", "Nav", ["LEFT", "RIGHT"]), layer("md", "Media", ["PLAY", "PAUSE"]));
    const t2 = doc(layer("b", "Base", ["A"]), layer("md", "Media", ["PLAY", "PAUSE"]), layer("nv", "Nav", ["LEFT", "RIGHT"]));
    expect(matchLayers(source, t1).map((x) => x.targetLayerId)).toEqual(matchLayers(source, t2).map((x) => x.targetLayerId));
  });
});
