// Conditional layers on ZMK (D-387): read from `zmk,conditional-layers`, written back, and renumbered with the layers.
import { describe, expect, test } from "bun:test";
import { generateZmkSource } from "../../../src/firmware/zmk/generate.ts";
import { importZmk } from "../../../src/firmware/zmk/import.ts";
import { applyOps as applyLayoutOps } from "../../../src/layout/apply-ops.ts";
import type { Layout } from "../../../src/layout/schema.ts";
import { TEMPLATE_FIXTURE, glove80 } from "../../helpers/zmk.ts";

const board = await glove80();
const def = board.definition;
const template = {
  keymap: await Bun.file(`${TEMPLATE_FIXTURE}/glove80.keymap`).text(),
  conf: await Bun.file(`${TEMPLATE_FIXTURE}/glove80.conf`).text(),
};

/** MoErgo's default keymap with a conditional_layers block before the keymap node; the template has none (its layers: 0 default, 1 lower, 2 magic, 3 factory test). */
export const withConditions = (block: string): { name: string; keymap: string; conf: string } => ({
  name: "glove80",
  conf: template.conf,
  keymap: template.keymap.replace("    keymap {", `${block}\n\n    keymap {`),
});

const TRI = `    conditional_layers {
        compatible = "zmk,conditional-layers";
        tri_layer {
            if-layers = <LOWER MAGIC>;
            then-layer = <3>;
        };
    };`;

const gen = (layout: Layout) => generateZmkSource({ layout, board: def, geometry: board.geometry, revisionId: "rev_T" });
const keymapOf = (layout: Layout) => gen(layout).files.find((f) => f.path === "glove80.keymap")?.content ?? "";

describe("importing conditional_layers from the Glove80 template with one added", () => {
  test("becomes a modelled condition on layer ids, and is not kept as code", async () => {
    const { layout, report } = await importZmk(withConditions(TRI), def);
    expect(layout.conditionalLayers).toEqual([{ id: "tri-layer", ifLayerIds: ["lower-layer", "magic-layer"], thenLayerId: "factory-test-layer" }]);
    expect(layout.passthrough.some((p) => p.source.includes("conditional-layers"))).toBe(false);
    expect(report.warnings.some((w) => w.includes("conditional"))).toBe(false);
  });

  test("is written back by index, and import, generate, import is stable", async () => {
    const first = (await importZmk(withConditions(TRI), def)).layout;
    const text = keymapOf(first);
    expect(text).toContain('conditional_layers {\n        compatible = "zmk,conditional-layers";\n\n        tri_layer {\n            if-layers = <1 2>;\n            then-layer = <3>;\n        };\n    };');
    // After the combos/behaviours and before the keymap node.
    expect(text.indexOf("conditional_layers {")).toBeLessThan(text.indexOf("keymap {"));
    const again = (await importZmk({ name: "glove80", keymap: text, conf: template.conf }, def)).layout;
    expect(again).toEqual(first);
  });

  test("a #define the condition used as a layer is still renumbered when layers move (D-360)", async () => {
    const { layout } = await importZmk(withConditions(TRI), def);
    // Move the factory-test layer in front of lower: factory 1, lower 2, magic 3.
    const moved = applyLayoutOps(layout, [{ op: "moveLayer", layerId: "factory-test-layer", afterLayerId: "default-layer" }]);
    if (!moved.ok) throw new Error(moved.error.message);
    const text = keymapOf(moved.layout);
    expect(text).toContain("if-layers = <2 3>;");
    expect(text).toContain("then-layer = <1>;");
    // The kept #defines that name layers by number follow too.
    expect(text).toContain("#define LOWER 2");
  });

  test("a condition on three layers is kept as written, inside a container the generator writes", async () => {
    const three = TRI.replace("<LOWER MAGIC>", "<0 1 2>");
    const { layout, report } = await importZmk(withConditions(three), def);
    expect(layout.conditionalLayers).toEqual([]);
    expect(report.warnings.some((w) => w.includes("conditional layer tri_layer kept as written: it waits for 3 layers"))).toBe(true);
    expect(layout.passthrough.find((p) => p.anchor === "conditional:tri_layer")?.source).toContain("if-layers = <0 1 2>;");
    const text = keymapOf(layout);
    expect(text).toContain('conditional_layers {\n        compatible = "zmk,conditional-layers";');
    expect(text).toContain("if-layers = <0 1 2>;");
  });

  test("one modelled and one kept condition share the container", async () => {
    const both = `    conditional_layers {
        compatible = "zmk,conditional-layers";
        tri_layer {
            if-layers = <1 2>;
            then-layer = <3>;
        };
        wide {
            if-layers = <0 1 2>;
            then-layer = <3>;
        };
    };`;
    const { layout } = await importZmk(withConditions(both), def);
    expect(layout.conditionalLayers.map((c) => c.id)).toEqual(["tri-layer"]);
    const text = keymapOf(layout);
    expect(text.match(/conditional_layers \{/g)).toHaveLength(1);
    expect(text).toContain("tri_layer {");
    expect(text).toContain("wide {");
  });

  test("a layout with no condition gets no container", async () => {
    const { layout } = await importZmk({ name: "glove80", ...template }, def);
    expect(keymapOf(layout)).not.toContain("conditional_layers");
  });
});
