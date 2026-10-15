import { describe, expect, test } from "bun:test";
import { isDeepStrictEqual } from "node:util";
import { loadBoardDir } from "../../../src/boards/load.ts";
import { GenerateError, generateQmkSource } from "../../../src/firmware/qmk/generate.ts";
import { upgradeLegacyLighting } from "../../../src/firmware/qmk/import-lighting.ts";
import { importOryxSource, importQmkSource } from "../../../src/firmware/qmk/import.ts";
import { readOryxSource } from "../../../src/firmware/qmk/source.ts";
import type { Layout } from "../../../src/layout/schema.ts";
import { FIXTURE_DIR, MOONLANDER_DIR, moonlander } from "../../helpers/board.ts";

const board = await moonlander();
const def = board.definition;
const leds = def.lighting?.ledPositions ?? [];
const imported = await importOryxSource(FIXTURE_DIR, def);
const layout = imported.layout;
const original = await Bun.file(`${FIXTURE_DIR}/keymap.c`).text();
const gen = (l: Layout) => generateQmkSource({ layout: l, board: def, revisionId: "rev_T" });
const keymapC = (l: Layout) => gen(l).files.find((f) => f.path === "keymap.c")?.content ?? "";

// Oryx's colour section: from the helper's declaration to the end of rgb_matrix_indicators_user().
const section = (text: string) => text.slice(text.indexOf("extern rgb_config_t"), text.indexOf("\n}\n", text.indexOf("bool rgb_matrix_indicators_user")) + 3);
const withLayer = (l: Layout, id: string, change: Partial<Layout["layers"][number]>): Layout => ({ ...l, layers: l.layers.map((x) => (x.id === id ? { ...x, ...change } : x)) });

describe("BK's Oryx layer colours", () => {
  test("import into the model on the four layers Oryx coloured, and nothing is left as code", () => {
    expect(imported.report.warnings).toEqual([]);
    expect(layout.layers.map((l) => l.lighting !== undefined)).toEqual([false, true, true, false, true, true]);
    expect(layout.passthrough.map((p) => p.anchor).filter((a) => a.startsWith("rgb"))).toEqual(["rgb"]);
    expect(layout.layers[1]?.lighting).toEqual({ layer: [188, 255, 255] });
  });

  test("regenerate identically: the generated colour section is Oryx's, character for character", () => {
    expect(section(keymapC(layout))).toBe(section(original));
  });

  test("LED numbers map to key positions through the board's table, not by index", () => {
    // Layer 5 lights the left hand's two outer columns: LED 5 sits under position 1 (the key next to the first), not under position 5.
    const lighting = layout.layers[5]?.lighting;
    expect(lighting?.keys?.["1"]).toEqual([0, 0, 255]);
    expect(lighting?.keys?.["5"]).toBeUndefined();
  });

  test("one coloured key changes exactly one LED of one row", () => {
    const next = withLayer(layout, "layer-1", { lighting: { layer: [188, 255, 255], keys: { "1": [21, 255, 255] } } });
    const before = section(original).split("\n");
    const after = section(keymapC(next)).split("\n");
    const changed = after.flatMap((line, i) => (line === before[i] ? [] : [i]));
    expect(changed).toHaveLength(1);
    const led = leds.indexOf(1);
    expect((after[changed[0] as number] as string).split("}, {")[led]).toContain("21,255,255");
  });

  test("a layer that gains colours gets a case in the indicators, and one that loses them loses it", () => {
    const gained = keymapC(withLayer(layout, "layer-3", { lighting: { layer: [85, 255, 255] } }));
    expect(gained).toContain("      case 3:\n        set_layer_color(3);");
    const lost = keymapC(withLayer(layout, "layer-1", { lighting: undefined as never }));
    expect(lost).not.toContain("case 1:");
    expect(lost).toContain("case 2:");
  });

  test("with every colour removed the helper and post-init stay and the ledmap goes", () => {
    const bare: Layout = { ...layout, layers: layout.layers.map(({ lighting: _l, ...rest }) => rest) };
    const text = keymapC(bare);
    expect(text).toContain("keyboard_post_init_user");
    expect(text).not.toContain("ledmap");
    expect(text).not.toContain("rgb_matrix_indicators_user");
  });

  test("reordering layers keeps each colour on its layer, because the case numbers follow the layers", () => {
    const moved: Layout = { ...layout, layers: [layout.layers[0], layout.layers[2], layout.layers[1], ...layout.layers.slice(3)] as Layout["layers"] };
    const text = keymapC(moved);
    // The layer that was index 1 (purple) is now index 2.
    expect(text).toContain("[2] = { {188,255,255}");
    expect(text).toContain("[1] = { {0,245,245}");
  });

  test("import -> generate -> import keeps the lighting", async () => {
    const files = { ...(await readOryxSource(FIXTURE_DIR)), keymapC: keymapC(layout), configH: gen(layout).files.find((f) => f.path === "config.h")?.content as string };
    const again = await importQmkSource(files, def);
    expect(isDeepStrictEqual(again.layout.layers.map((l) => l.lighting), layout.layers.map((l) => l.lighting))).toBe(true);
  });
});

describe("colour code that isn't Oryx's stays code", () => {
  test("an edited ledmap is kept as passthrough with a warning, and colours can't be generated beside it", async () => {
    const edited = original.replace("{188,255,255}", "{187,255,255}");
    const files = { ...(await readOryxSource(FIXTURE_DIR)), keymapC: edited };
    // One value changed still reads back exactly (it is a valid ledmap), so break the shape instead.
    const broken = { ...files, keymapC: original.replace("void set_layer_color(int layer) {", "void set_layer_color(int layer) {\n  // mine") };
    const result = await importQmkSource(broken, def);
    expect(result.report.warnings.join(" ")).toContain("kept as code");
    expect(result.layout.layers.every((l) => l.lighting === undefined)).toBe(true);
    expect(result.layout.passthrough.some((p) => p.anchor === "rgb-ledmap")).toBe(true);
    const unchanged = generateQmkSource({ layout: result.layout, board: def, revisionId: "x" }).files.find((f) => f.path === "keymap.c")?.content ?? "";
    expect(section(unchanged)).toContain("// mine");
    const colour = withLayer(result.layout, "layer-3", { lighting: { layer: [85, 255, 255] } });
    expect(() => generateQmkSource({ layout: colour, board: def, revisionId: "x" })).toThrow(GenerateError);
  });

  test("a layout with no colour code gets the helper and post-init added with its first colour", async () => {
    const files = await readOryxSource(FIXTURE_DIR);
    const start = original.indexOf("extern rgb_config_t");
    const end = original.indexOf("\n}\n", original.indexOf("bool rgb_matrix_indicators_user")) + 3;
    const bare = await importQmkSource({ ...files, keymapC: original.slice(0, start) + original.slice(end) }, def);
    expect(bare.layout.layers.every((l) => l.lighting === undefined)).toBe(true);
    const lit = withLayer(bare.layout, "layer-1", { lighting: { layer: [188, 255, 255] } });
    const text = generateQmkSource({ layout: lit, board: def, revisionId: "x" }).files.find((f) => f.path === "keymap.c")?.content ?? "";
    expect(text).toContain("keyboard_post_init_user");
    expect(text).toContain("[1] = {");
  });

  test("a board with no per-key RGB refuses colours instead of dropping them", async () => {
    const corne = await loadBoardDir(`${MOONLANDER_DIR}/../../foostan/corne`);
    expect(corne.definition.lighting).toBeUndefined();
    const { lighting, ...noLighting } = def;
    void lighting;
    expect(() => generateQmkSource({ layout: withLayer(layout, "layer-3", { lighting: { layer: [1, 2, 3] } }), board: noLighting, revisionId: "x" })).toThrow(/no per-key RGB/);
  });
});

describe("layouts saved before colours were modelled", () => {
  test("their colours are read from the old passthrough piece into the same model a fresh import gives", async () => {
    // The same source imported on a board that doesn't know about lighting is what v0.10 stored.
    const { lighting, ...legacyBoard } = def;
    void lighting;
    const split = (await importOryxSource(FIXTURE_DIR, legacyBoard)).layout;
    // v0.10 kept the helper, the ledmap and the indicators as one piece with the anchor "rgb".
    const rgb = split.passthrough.filter((p) => p.anchor.startsWith("rgb"));
    const legacy: Layout = {
      ...split,
      passthrough: split.passthrough.flatMap((p) => (p === rgb[0] ? [{ ...p, anchor: "rgb", source: rgb.map((r) => r.source).join("\n\n"), refersToLayerIndices: true }] : rgb.includes(p) ? [] : [p])),
    };
    expect(legacy.passthrough.find((p) => p.anchor === "rgb")?.source).toContain("ledmap[]");
    const upgraded = upgradeLegacyLighting(legacy, leds);
    expect(upgraded).not.toBeNull();
    expect(upgraded?.layers.map((l) => l.lighting)).toEqual(layout.layers.map((l) => l.lighting));
    expect(isDeepStrictEqual(upgraded?.passthrough.find((p) => p.anchor === "rgb"), layout.passthrough.find((p) => p.anchor === "rgb"))).toBe(true);
  });

  test("a layout that has been upgraded, or has no ledmap, is left alone", () => {
    expect(upgradeLegacyLighting(layout, leds)).toBeNull();
  });
});
