import { describe, expect, test } from "bun:test";
import { renumber } from "../../../src/layout/layer-refs.ts";
import { readZmkLayerRefs } from "../../../src/firmware/zmk/layer-refs.ts";
import type { ZmkSite } from "../../../src/firmware/zmk/layer-refs.ts";

const ids = ["l0", "l1", "l2", "l3", "l4"];
const flipped = [...ids].reverse();

async function read(source: string, kind: ZmkSite["kind"] = "node", keymapCalls: { name: string; params: string[] }[] = []) {
  const found = (await readZmkLayerRefs([{ site: "s", source, kind }], {
    layerIds: ids, layerBehaviours: new Map([["lower", 0]]), keymapCalls, defines: new Map([["NAV", "1"], ["LOWER", "2"]]),
  })).get("s");
  return { out: renumber(source, found?.layerRefs, flipped), unprovable: found?.unprovable ?? [] };
}

describe("ZMK layer numbers in kept devicetree", () => {
  test("the layer parameter of a layer behaviour is renumbered, and the key parameter is not", async () => {
    const r = await read("td: tap_dance { bindings = <&mo 1>, <&to 3>; };\nm: m { bindings = <&lt 2 3 &kp N3 &sl 4>; };");
    expect(r.out).toBe("td: tap_dance { bindings = <&mo 3>, <&to 1>; };\nm: m { bindings = <&lt 2 3 &kp N3 &sl 0>; };");
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
