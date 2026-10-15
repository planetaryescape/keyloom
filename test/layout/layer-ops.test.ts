import { describe, expect, test } from "bun:test";
import { applyOps } from "../../src/layout/apply-ops.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import {
  addLayerChange, cleanShortLabel, convertLayerOps, copyLayerName, duplicateLayerChange, layerColorOf, layerReferences, layerShortLabel,
  moveLayerOps, newLayerId, niceLayerName, nextLayerName,
} from "../../src/layout/layer-ops.ts";
import { layerLegend } from "../../src/layout/legend.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { validate } from "../../src/validation/validate.ts";
import { T, key, tiny, tinyBoard } from "../helpers/tiny.ts";

const run = (ops: ChangeOp[], layout: Layout = tiny()) => {
  const r = applyOps(layout, ops);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.layout;
};
const ids = (layout: Layout) => layout.layers.map((layer) => layer.id);

describe("moveLayer", () => {
  test("moves by id to just after another layer and leaves the keys alone", () => {
    const out = run([{ op: "moveLayer", layerId: "nav", afterLayerId: "base" }]);
    expect(ids(out)).toEqual(["base", "nav", "num"]);
    expect(out.layers[1]?.bindings).toEqual(tiny().layers[2]?.bindings);
  });

  test("the layer keys that name a layer still find it after a reorder, because they use ids", () => {
    const out = run([{ op: "moveLayer", layerId: "num", afterLayerId: "nav" }]);
    expect(ids(out)).toEqual(["base", "nav", "num"]);
    expect(out.layers[0]?.bindings[2]).toEqual({ kind: "layer", action: "momentary", layerId: "num" });
    expect(validate(tinyBoard, tiny(), [{ op: "moveLayer", layerId: "num", afterLayerId: "nav" }]).ok).toBe(true);
  });

  test("the base layer cannot move and nothing goes before it", () => {
    const r = applyOps(tiny(), [{ op: "moveLayer", layerId: "base", afterLayerId: "nav" }]);
    expect(r.ok).toBe(false);
    expect(moveLayerOps(tiny(), "num", 0)).toBeNull();
    expect(moveLayerOps(tiny(), "base", 1)).toBeNull();
  });

  test("moveLayerOps names the layer to go after, counted without the moving layer", () => {
    expect(moveLayerOps(tiny(), "nav", 1)).toEqual([{ op: "moveLayer", layerId: "nav", afterLayerId: "base" }]);
    expect(moveLayerOps(tiny(), "num", 2)).toEqual([{ op: "moveLayer", layerId: "num", afterLayerId: "nav" }]);
    expect(moveLayerOps(tiny(), "num", 1)).toBeNull();
    expect(moveLayerOps(tiny(), "num", 3)).toBeNull();
  });

  test("a moved layer that custom code numbers is refused", () => {
    const layout = tiny({ passthrough: [{ firmware: "qmk", file: "keymap.c", anchor: "x", source: "layer_on(2);", refersToLayerIndices: true }] });
    const result = validate(tinyBoard, layout, [{ op: "moveLayer", layerId: "nav", afterLayerId: "base" }]);
    expect(result.errors.map((e) => e.code)).toContain("passthrough_layer_index");
  });
});

describe("duplicateLayer", () => {
  test("copies the keys under a new id and name, as the last layer, without its look", () => {
    const layout = tiny();
    layout.layers[1] = { ...layout.layers[1]!, shortLabel: "NUM", color: 3 };
    const change = duplicateLayerChange(layout, "num");
    expect(change).toMatchObject({ layerId: "numbers-copy", name: "Numbers copy" });
    const out = run(change?.ops ?? [], layout);
    expect(ids(out)).toEqual(["base", "num", "nav", "numbers-copy"]);
    expect(out.layers[3]?.bindings).toEqual(layout.layers[1]?.bindings);
    expect(out.layers[3]?.shortLabel).toBeUndefined();
    expect(out.layers[3]?.bindings).not.toBe(out.layers[1]?.bindings);
  });

  test("a copy keeps every other layer's number, so numbered custom code still points at the right layers", () => {
    const layout = tiny({ passthrough: [{ firmware: "qmk", file: "keymap.c", anchor: "x", source: "layer_on(2);", refersToLayerIndices: true }] });
    expect(validate(tinyBoard, layout, duplicateLayerChange(layout, "num")?.ops ?? []).errors.map((e) => e.code)).not.toContain("passthrough_layer_index");
  });

  test("names do not collide when copying twice", () => {
    const first = run(duplicateLayerChange(tiny(), "nav")?.ops ?? []);
    expect(duplicateLayerChange(first, "nav")?.name).toBe("Nav copy 2");
    expect(copyLayerName(tiny(), "Fresh")).toBe("Fresh copy");
  });

  test("an unknown layer or id is refused", () => {
    expect(duplicateLayerChange(tiny(), "nope")).toBeNull();
    expect(applyOps(tiny(), [{ op: "duplicateLayer", layerId: "nav", layer: { id: "num", name: "X" } }]).ok).toBe(false);
  });
});

describe("addLayer", () => {
  test("adds a transparent layer named Layer N with a fresh id", () => {
    const change = addLayerChange(tiny());
    expect(change.name).toBe("Layer 4");
    const out = run(change.ops);
    expect(ids(out)).toEqual(["base", "num", "nav", "layer-4"]);
    expect(out.layers[3]?.bindings).toEqual([T, T, T, T]);
  });

  test("skips a number a layer already uses and picks an unused id", () => {
    const layout = tiny();
    layout.layers[1] = { ...layout.layers[1]!, name: "Layer 4" };
    expect(nextLayerName(layout)).toBe("Layer 5");
    expect(newLayerId(layout, "Nav")).toBe("nav-2");
    expect(newLayerId(layout, "123")).toBe("layer-123");
    expect(newLayerId(layout, "Über Büro")).toMatch(/^[a-z][a-z0-9-]*$/);
  });
});

describe("setLayerStyle", () => {
  test("sets and clears the label and colour, and the legend prints the label", () => {
    const styled = run([{ op: "setLayerStyle", layerId: "num", shortLabel: "N#", color: 4 }]);
    expect(styled.layers[1]).toMatchObject({ shortLabel: "N#", color: 4 });
    expect(layerLegend("num", styled)).toBe("N#");
    expect(layerColorOf(styled.layers, 1)).toBe(4);
    const cleared = run([{ op: "setLayerStyle", layerId: "num", shortLabel: null, color: null }], styled);
    expect(cleared.layers[1]).not.toHaveProperty("shortLabel");
    expect(layerShortLabel(cleared.layers[1]!)).toBe("NUM");
    expect(layerColorOf(cleared.layers, 1)).toBe(2);
  });

  test("a label over four characters or a colour outside 1 to 6 does not parse", () => {
    const bad = validate(tinyBoard, tiny(), [{ op: "setLayerStyle", layerId: "num", shortLabel: "TOOLONG", color: 9 }]);
    expect(bad.ok).toBe(false);
    expect(cleanShortLabel("  navigation ")).toBe("navi");
    expect(cleanShortLabel("   ")).toBeNull();
  });
});

describe("bulk convert", () => {
  test("turns every transparent key into none as setBinding ops, and back", () => {
    const ops = convertLayerOps(tiny(), "num", "transparent", "none");
    expect(ops).toEqual([{ op: "setBinding", at: { layerId: "num", position: 2 }, binding: { kind: "none" } }]);
    const out = run(ops ?? []);
    expect(out.layers[1]?.bindings[2]).toEqual({ kind: "none" });
    expect(convertLayerOps(out, "num", "none", "transparent")).toHaveLength(1);
  });

  test("nothing to convert is null, never an empty change", () => {
    expect(convertLayerOps(tiny(), "base", "transparent", "none")).toBeNull();
    expect(convertLayerOps(tiny(), "nope", "transparent", "none")).toBeNull();
  });
});

describe("deleting a layer", () => {
  test("lists every key that switches to it and the validator refuses", () => {
    const refs = layerReferences(tiny(), "num");
    expect(refs).toEqual([{ slot: { layerId: "base", position: 2 }, text: "Base, key 3 holds Numbers" }]);
    const result = validate(tinyBoard, tiny(), [{ op: "removeLayer", layerId: "num" }]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "unknown_ref" && e.slots?.some((s) => s.layerId === "base" && s.position === 2))).toBe(true);
  });

  test("names hold-tap holds, combo outputs and combos limited to the layer", () => {
    const layout = tiny({
      combos: [
        { id: "c1", name: "Go nav", positions: [0, 1], layerIds: "all", output: { kind: "layer", action: "toggle", layerId: "nav" } },
        { id: "c2", name: "Quote", positions: [1, 2], layerIds: ["base", "nav"], output: key("Q") },
      ],
    });
    layout.layers[0] = { ...layout.layers[0]!, bindings: [{ kind: "holdTap", tap: { code: "A" }, hold: { layerId: "nav" }, profileId: "p" }, key("B"), T, key("D")] };
    const texts = layerReferences(layout, "nav").map((r) => r.text);
    expect(texts).toEqual(["Base, key 1 holds Nav", "The combo Go nav toggles Nav", "The combo Quote is set up on Nav"]);
    expect(validate(tinyBoard, layout, [{ op: "removeLayer", layerId: "nav" }]).ok).toBe(false);
  });

  test("a tap dance slot that goes to the layer counts, and the validator sees it", () => {
    const layout = tiny({
      combos: [],
      tapDances: [{ id: "td", name: "Twice", tap: { kind: "key", code: "A" }, doubleTap: { kind: "layer", action: "to", layerId: "nav" } }],
    });
    layout.layers[0] = { ...layout.layers[0]!, bindings: [{ kind: "tapDance", tapDanceId: "td" }, key("B"), T, key("D")] };
    expect(layerReferences(layout, "nav").map((r) => r.text)).toEqual(["Base, key 1 is the tap dance Twice, which goes to Nav"]);
    expect(validate(tinyBoard, layout, [{ op: "removeLayer", layerId: "nav" }]).errors.map((e) => e.code)).toContain("unknown_ref");
  });

  test("a layer nothing points at deletes cleanly, and keys on the layer itself are not references", () => {
    const layout = tiny({ combos: [] });
    layout.layers[2] = { ...layout.layers[2]!, bindings: [{ kind: "layer", action: "to", layerId: "nav" }, T, T, T] };
    expect(layerReferences(layout, "nav")).toEqual([]);
    const gone = applyOps(layout, [{ op: "removeLayer", layerId: "nav" }]);
    expect(gone.ok).toBe(true);
  });
});

describe("how a layer name reads", () => {
  test("underscored firmware names read as words, and names with spaces are left alone", () => {
    expect(niceLayerName("one_shot")).toBe("One shot");
    expect(niceLayerName("Left Hand")).toBe("Left Hand");
    expect(niceLayerName("_")).toBe("_");
    expect(niceLayerName("Base")).toBe("Base");
  });
});
