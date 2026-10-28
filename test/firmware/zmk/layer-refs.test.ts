import { describe, expect, test } from "bun:test";
import { renumber } from "../../../src/layout/layer-refs.ts";
import { readZmkLayerRefs } from "../../../src/firmware/zmk/layer-refs.ts";
import type { ZmkSite } from "../../../src/firmware/zmk/layer-refs.ts";

const ids = ["l0", "l1", "l2", "l3", "l4"];
const flipped = [...ids].reverse();

async function read(source: string, kind: ZmkSite["kind"] = "node", keymapCalls: { name: string; params: string[] }[] = [], layerBehaviours = new Map([["lower", 0]])) {
  const found = (await readZmkLayerRefs([{ site: "s", source, kind }], {
    layerIds: ids, layerBehaviours, keymapCalls, defines: new Map([["NAV", "1"], ["LOWER", "2"]]),
  })).get("s");
  return { out: renumber(source, found?.layerRefs, flipped), unprovable: found?.unprovable ?? [] };
}

describe("ZMK layer numbers in kept devicetree", () => {
  test("the layer parameter of a layer behaviour is renumbered, and the key parameter is not", async () => {
    const r = await read("td: tap_dance { bindings = <&mo 1>, <&to 3>; };\nm: m { bindings = <&lt 2 3 &kp N3 &sl 4>; };");
    expect(r.out).toBe("td: tap_dance { bindings = <&mo 3>, <&to 1>; };\nm: m { bindings = <&lt 2 3 &kp N3 &sl 0>; };");
  });

  test("custom layer and sticky behaviours and macro bindings follow layer order", async () => {
    const source = "my_mo: behavior { compatible = \"zmk,behavior-momentary-layer\"; #binding-cells = <1>; };\nmy_sticky: behavior { compatible = \"zmk,behavior-sticky-key\"; bindings = <&my_mo>; };\nm: macro { bindings = <&mo 1>; };\nx: x { bindings = <&my_mo 1 &my_sticky 3>; };";
    const r = await read(source, "node", [], new Map([["my_mo", 0], ["my_sticky", 0]]));
    expect(r.out).toContain("bindings = <&mo 3>");
    expect(r.out).toContain("bindings = <&my_mo 3 &my_sticky 1>");
    expect(r.unprovable).toEqual([]);
  });

  test("a kept key is read as a binding: &magic's layer, and a custom hold-tap that holds a layer", async () => {
    expect((await read("&magic 4 0", "binding")).out).toBe("&magic 0 0");
    expect((await read("&lower 1 A", "binding")).out).toBe("&lower 3 A");
    expect((await read("&bt BT_SEL 3", "binding")).out).toBe("&bt BT_SEL 3");
  });

  test("combo and conditional-layer properties list layer numbers, and -1 means all of them", async () => {
    const r = await read("c { layers = <0 (-1) 4>; if-layers = <1 2>; then-layer = <3>; };");
    expect(r.out).toBe("c { layers = <4 (-1) 0>; if-layers = <3 2>; then-layer = <1>; };");
  });

  test("a define used only as a layer is renumbered where it is defined, and the keys that use it by name are left", async () => {
    const found = await read("#define NAV 1\n", "define", [{ name: "mo", params: ["NAV"] }]);
    expect(found.out).toBe("#define NAV 3\n");
  });

  test("a define the keymap's own keys use as a layer counts even when no kept source uses it", async () => {
    expect((await read("#define LOWER 2", "define", [{ name: "lt", params: ["LOWER", "A"] }])).out).toBe("#define LOWER 2");
    expect((await read("#define LOWER 2", "define", [{ name: "lt", params: ["LOWER", "A"] }])).unprovable).toEqual([]);
  });

  test("a define with no layer use is just a number", async () => {
    expect(await read("#define NAV 1", "define")).toEqual({ out: "#define NAV 1", unprovable: [] });
  });

  test("a define used as a layer and as something else is refused at the other use", async () => {
    const both = await readZmkLayerRefs([
      { site: "d", source: "#define NAV 1", kind: "define" },
      { site: "n", source: "tuned: t {\n  bindings = <&mo NAV>;\n  tapping-term-ms = <NAV>;\n};", kind: "node" },
    ], { layerIds: ids, layerBehaviours: new Map(), keymapCalls: [], defines: new Map([["NAV", "1"]]) });
    expect(both.get("n")?.unprovable.map((u) => u.line).sort()).toEqual([2, 3]);
    expect(both.get("d")?.unprovable[0]).toEqual({ line: 1, text: "#define NAV 1" });
  });

  test("a layer name that no define gives a number to is refused, naming the line", async () => {
    const r = await read("x: x {\n  bindings = <&mo MYSTERY>;\n};");
    expect(r.unprovable).toEqual([{ line: 2, text: "bindings = <&mo MYSTERY>;" }]);
  });
});

describe("a #define used as a layer in a kept key (MoErgo's `&magic MAGIC 0`)", () => {
  const sites = (defineSource: string, keySource: string) => [
    { site: "d", source: defineSource, kind: "define" as const },
    { site: "k", source: keySource, kind: "binding" as const },
  ];
  const resolve = (s: ZmkSite[], defines: [string, string][] = [["MAGIC", "2"]]) => readZmkLayerRefs(s, {
    layerIds: ids, layerBehaviours: new Map(), keymapCalls: [], defines: new Map(defines),
  });

  test("the key records the ref on its layer parameter, and the define keeps its own", async () => {
    const found = await resolve(sites("#define MAGIC 2", "&magic MAGIC 0"));
    expect(found.get("k")).toEqual({ layerRefs: [{ start: 7, end: 12, layerId: "l2" }], unprovable: [] });
    expect(found.get("d")?.layerRefs).toEqual([{ start: 14, end: 15, layerId: "l2" }]);
  });

  test("the ref follows the name when the source has extra spacing between its words", async () => {
    const found = await resolve(sites("#define MAGIC 2", "&magic   MAGIC\t0"));
    expect(found.get("k")?.layerRefs).toEqual([{ start: 9, end: 14, layerId: "l2" }]);
  });

  test("renumbering moves the define's number and leaves the key's name alone", async () => {
    const found = await resolve(sites("#define MAGIC 2", "&magic MAGIC 0"));
    const moved = ["l2", "l0", "l1"];
    expect(renumber("#define MAGIC 2", found.get("d")?.layerRefs, moved)).toBe("#define MAGIC 0");
    expect(renumber("&magic MAGIC 0", found.get("k")?.layerRefs, moved)).toBe("&magic MAGIC 0");
  });

  test("a define used by two keys is recorded on each key, and on the define once", async () => {
    const found = await resolve([
      { site: "d", source: "#define MAGIC 2", kind: "define" },
      { site: "k1", source: "&magic MAGIC 0", kind: "binding" },
      { site: "k2", source: "&magic MAGIC 1", kind: "binding" },
    ]);
    expect(found.get("k1")?.layerRefs).toEqual([{ start: 7, end: 12, layerId: "l2" }]);
    expect(found.get("k2")?.layerRefs).toEqual([{ start: 7, end: 12, layerId: "l2" }]);
    expect(found.get("d")?.layerRefs).toHaveLength(1);
  });

  test("identical duplicate defines give a key one ref, and each define its own", async () => {
    const found = await readZmkLayerRefs([
      { site: "d1", source: "#define MAGIC 2", kind: "define" },
      { site: "d2", source: "#define MAGIC 2", kind: "define" },
      { site: "k", source: "&magic MAGIC 0", kind: "binding" },
    ], { layerIds: ids, layerBehaviours: new Map(), keymapCalls: [], defines: new Map([["MAGIC", "2"]]) });
    expect(found.get("k")?.layerRefs).toEqual([{ start: 7, end: 12, layerId: "l2" }]);
    expect(found.get("d1")?.layerRefs).toEqual([{ start: 14, end: 15, layerId: "l2" }]);
    expect(found.get("d2")?.layerRefs).toEqual([{ start: 14, end: 15, layerId: "l2" }]);
  });

  test("a hex define follows its layer: the number is rewritten, the name is not", async () => {
    const found = await resolve(sites("#define MAGIC 0x2", "&magic MAGIC 0"));
    expect(renumber("#define MAGIC 0x2", found.get("d")?.layerRefs, ["l2", "l0", "l1"])).toBe("#define MAGIC 0");
  });

  test("a define that is also used for something else is refused on the key too, and the key gets no ref", async () => {
    const found = await readZmkLayerRefs([
      { site: "d", source: "#define MAGIC 2", kind: "define" },
      { site: "k", source: "&magic MAGIC 0", kind: "binding" },
      { site: "n", source: "t: t { tapping-term-ms = <MAGIC>; };", kind: "node" },
    ], { layerIds: ids, layerBehaviours: new Map(), keymapCalls: [], defines: new Map([["MAGIC", "2"]]) });
    expect(found.get("k")?.layerRefs).toEqual([]);
    expect(found.get("k")?.unprovable).toEqual([{ line: 1, text: "&magic MAGIC 0" }]);
    expect(found.get("d")?.layerRefs).toEqual([]);
  });

  test("a define that names no layer is not a layer ref, wherever it is used", async () => {
    const found = await resolve([
      { site: "d", source: "#define TAP_MS 200", kind: "define" },
      { site: "k", source: "&kp TAP_MS", kind: "binding" },
    ], [["TAP_MS", "200"]]);
    expect(found.get("k")).toBeUndefined();
    expect(found.get("d")).toBeUndefined();
  });

  test("a define with a non-layer number used in a layer position is refused where it is used", async () => {
    const found = await resolve([
      { site: "d", source: "#define TAP_MS 200", kind: "define" },
      { site: "k", source: "&magic TAP_MS 0", kind: "binding" },
    ], [["TAP_MS", "200"]]);
    expect(found.get("k")).toEqual({ layerRefs: [], unprovable: [{ line: 1, text: "&magic TAP_MS 0" }] });
  });

  test("a define named like an Object prototype property is read as any other name", async () => {
    const found = await resolve(sites("#define constructor 2", "&magic constructor 0"), [["constructor", "2"]]);
    expect(found.get("k")?.layerRefs).toEqual([{ start: 7, end: 18, layerId: "l2" }]);
    expect(found.get("d")?.layerRefs).toEqual([{ start: 20, end: 21, layerId: "l2" }]);
  });
});
