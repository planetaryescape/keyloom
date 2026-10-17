import { describe, expect, test } from "bun:test";
import { renumber } from "../../../src/layout/layer-refs.ts";
import { readQmkLayerRefs } from "../../../src/firmware/qmk/layer-refs.ts";
import type { QmkSite } from "../../../src/firmware/qmk/layer-refs.ts";

const ids = ["l0", "l1", "l2", "l3", "l4", "l5"];
/** What the source says once layer 0 and 5 swap, 1 and 4, 2 and 3: every layer number n written as 5 - n. */
const flipped = [...ids].reverse();

async function read(source: string, kind: QmkSite["kind"] = "code") {
  const found = (await readQmkLayerRefs([{ site: "s", source, kind }], ids)).get("s");
  return { out: renumber(source, found?.layerRefs, flipped), unprovable: found?.unprovable ?? [] };
}

describe("QMK layer numbers in kept C", () => {
  test("the layer argument of layer keycodes and layer functions is renumbered, and the key argument is not", async () => {
    const r = await read("x = LT(2, KC_1); y = MO(1); z = TO(4); w = OSL(3); layer_move(5); layer_on(0); IS_LAYER_ON(2);");
    expect(r.out).toBe("x = LT(3, KC_1); y = MO(4); z = TO(1); w = OSL(2); layer_move(0); layer_on(5); IS_LAYER_ON(3);");
    expect(r.unprovable).toEqual([]);
  });

  test("a layer after a state argument, and the layers of a tri-layer, are renumbered", async () => {
    const r = await read("layer_state_t f(layer_state_t state) { if (layer_state_cmp(state, 2)) {} return update_tri_layer_state(state, 1, 2, 3); }");
    expect(r.out).toContain("layer_state_cmp(state, 3)");
    expect(r.out).toContain("update_tri_layer_state(state, 4, 3, 2)");
  });

  test("case labels count only in a switch over the active layer", async () => {
    const r = await read("void f(layer_state_t s) { switch (get_highest_layer(s)) { case 1: a(); break; case 4: b(); break; } switch (keycode) { case 3: c(); } }");
    expect(r.out).toContain("case 4: a()");
    expect(r.out).toContain("case 1: b()");
    expect(r.out).toContain("switch (keycode) { case 3: c(); }");
  });

  test("comparing the active layer for equality is renumbered, comparing it by order is refused", async () => {
    const r = await read("bool f(void) {\n  if (biton32(layer_state) == 2) return 1;\n  return get_highest_layer(layer_state) > 3;\n}");
    expect(r.out).toContain("== 3");
    expect(r.unprovable).toEqual([{ line: 3, text: "return get_highest_layer(layer_state) > 3;" }]);
  });

  test("ledmap rows by designator and ledmap[n] are renumbered", async () => {
    const r = await read("const uint8_t PROGMEM ledmap[][2][3] = {\n  [1] = { {0,1,2}, {3,4,5} },\n  [4] = { {6,7,8}, {9,10,11} },\n};\nvoid g(void) { x = ledmap[4][0][1]; }");
    expect(r.out).toContain("[4] = { {0,1,2}");
    expect(r.out).toContain("[1] = { {6,7,8}");
    expect(r.out).toContain("ledmap[1][0][1]");
    expect(r.out).toContain("{0,1,2}");
  });

  test("ledmap rows without a designator are refused, because their order is the layer order", async () => {
    const r = await read("const uint8_t ledmap[][1][3] = {\n  { {0,1,2} },\n  { {3,4,5} },\n};");
    expect(r.unprovable.map((u) => u.line)).toEqual([2, 3]);
  });

  test("a function whose parameter indexes ledmap makes its callers' arguments layer numbers", async () => {
    const r = await read("void set_color(int layer) { h = ledmap[layer][0][0]; }\nvoid g(void) { set_color(2); set_color(5); }");
    expect(r.out).toContain("set_color(3); set_color(0);");
  });

  test("a define used only in layer positions is renumbered where it is defined", async () => {
    const r = await read("#define NAV 2\nvoid f(void) { layer_move(NAV); x = TO(NAV); }");
    expect(r.out).toBe("#define NAV 3\nvoid f(void) { layer_move(NAV); x = TO(NAV); }");
  });

  test("a define that is also used as a plain number is refused at that use, and so are its layer uses", async () => {
    const r = await read("#define NAV 2\nvoid f(void) {\n  layer_move(NAV);\n  int n = NAV + 1;\n}");
    expect(r.out).toContain("#define NAV 2");
    expect(r.unprovable.map((u) => u.line).sort()).toEqual([1, 3, 4]);
    expect(r.unprovable.find((u) => u.line === 4)?.text).toBe("int n = NAV + 1;");
  });

  test("a define whose body is a layer key is read as code", async () => {
    const r = await read("#define DUAL_FUNC_0 LT(5, KC_4)\n");
    expect(r.out).toBe("#define DUAL_FUNC_0 LT(0, KC_4)\n");
  });

  test("arithmetic on a layer number, a layer name and a mask are refused, naming the line", async () => {
    const r = await read("void f(void) {\n  layer_move(n + 1);\n  layer_move(NAV);\n  layer_state_set(1UL << 3);\n  layer_on(2);\n}");
    expect(r.unprovable).toEqual([
      { line: 2, text: "layer_move(n + 1);" },
      { line: 3, text: "layer_move(NAV);" },
      { line: 4, text: "layer_state_set(1UL << 3);" },
    ]);
  });

  test("a number the layout has no layer for is refused", async () => {
    expect((await read("layer_move(9);")).unprovable).toEqual([{ line: 1, text: "layer_move(9);" }]);
  });

  test("process_record_user cases are read inside their switch", async () => {
    const r = await read("case DUAL_FUNC_0:\n  if (record->event.pressed) { layer_move(5); }\n  return false;", "cases");
    expect(r.out).toContain("layer_move(0)");
  });

  test("a kept key is read as an expression", async () => {
    expect((await read("LT(5, KC_A)", "binding")).out).toBe("LT(0, KC_A)");
    expect((await read("OSM(MOD_LSFT)", "binding")).out).toBe("OSM(MOD_LSFT)");
  });

  test("code with no layer numbers has nothing to renumber or refuse", async () => {
    const r = await read("void f(void) { tap_code(KC_A); x = 3; switch (n) { case 2: break; } }");
    expect(r).toEqual({ out: "void f(void) { tap_code(KC_A); x = 3; switch (n) { case 2: break; } }", unprovable: [] });
  });
});
