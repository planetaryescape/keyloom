import { describe, expect, test } from "bun:test";
import { missingLayerNumbers, renumber, withLayerNumbers } from "../../src/layout/layer-refs.ts";
import { key, tiny } from "../helpers/tiny.ts";

describe("renumber", () => {
  const ids = ["a", "b", "c"];
  test("writes each recorded number as its layer's index, and widens the text when it must", () => {
    expect(renumber("MO(1) TO(2)", [{ start: 3, end: 4, layerId: "c" }, { start: 9, end: 10, layerId: "a" }], ids)).toBe("MO(2) TO(0)");
    const many = Array.from({ length: 12 }, (_, i) => `l${i}`);
    expect(renumber("MO(1)", [{ start: 3, end: 4, layerId: "l11" }], many)).toBe("MO(11)");
  });

  test("a number that already reads right keeps the way it was written", () => {
    expect(renumber("MO(0x1)", [{ start: 3, end: 6, layerId: "b" }], ids)).toBe("MO(0x1)");
  });

  test("a number whose layer is gone is left as written, and missingLayerNumbers names the layer", () => {
    const refs = [{ start: 3, end: 4, layerId: "z" }];
    expect(renumber("MO(1)", refs, ids)).toBe("MO(1)");
    const layout = tiny({ passthrough: [{ firmware: "qmk", file: "keymap.c", anchor: "x", source: "MO(1)", refersToLayerIndices: true, layerRefs: refs }] });
    expect(missingLayerNumbers(layout)).toEqual(["z"]);
    expect(missingLayerNumbers(tiny())).toEqual([]);
  });

  test("a source without recorded numbers is returned as it is", () => {
    expect(renumber("MO(1)", undefined, ids)).toBe("MO(1)");
    expect(renumber("MO(1)", [], ids)).toBe("MO(1)");
  });
});

describe("withLayerNumbers", () => {
  test("renumbers kept source and kept keys, and returns the same object when there is nothing to do", () => {
    const plain = tiny();
    expect(withLayerNumbers(plain)).toBe(plain);
    const layout = tiny({
      passthrough: [{ firmware: "qmk", file: "keymap.c", anchor: "x", source: "layer_on(1);", refersToLayerIndices: true, layerRefs: [{ start: 9, end: 10, layerId: "num" }] }],
    });
    const moved = { ...layout, layers: [layout.layers[0], layout.layers[2], layout.layers[1]] } as typeof layout;
    expect(withLayerNumbers(moved).passthrough[0]?.source).toBe("layer_on(2);");
    const withKey = { ...moved, layers: moved.layers.map((l, i) => (i === 0 ? { ...l, bindings: [key("A"), { kind: "native" as const, firmware: "zmk" as const, source: "&magic 1 0", label: "Magic", layerRefs: [{ start: 7, end: 8, layerId: "num" }] }, ...l.bindings.slice(2)] } : l)) };
    expect(withLayerNumbers(withKey).layers[0]?.bindings[1]).toMatchObject({ source: "&magic 2 0" });
  });
});
