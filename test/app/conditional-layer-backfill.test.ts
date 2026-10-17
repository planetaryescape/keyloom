// A stored layout whose kept code holds a conditional layer gets it read into the model at startup, as one revision (D-390).
import { describe, expect, test } from "bun:test";
import { backfillConditionalLayers, backfillLayerRefs, checkChange, closeApp, getLayout, listRevisions, openApp } from "../../src/app/index.ts";
import { generateQmkSource } from "../../src/firmware/qmk/generate.ts";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { generateZmkSource } from "../../src/firmware/zmk/generate.ts";
import { importZmkSource } from "../../src/firmware/zmk/import.ts";
import { sameBuild } from "../../src/layout/conditional-backfill.ts";
import type { Layout, Passthrough } from "../../src/layout/schema.ts";
import { createLayout } from "../../src/persistence/layouts.ts";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";
import { tempDir } from "../helpers/tmp.ts";
import { TEMPLATE_FIXTURE, glove80 } from "../helpers/zmk.ts";

const store = (name: string, layout: Layout) => {
  const app = openApp({ dataDir: tempDir() });
  return { app, id: createLayout(app.db, { name, layout, summary: "Imported", origin: "import" }).layout.id };
};
const quiet = () => {
  const lines: string[] = [];
  return { lines, log: (m: string) => lines.push(m) };
};
const kept = (firmware: "qmk" | "zmk", anchor: string, source: string): Passthrough => ({ firmware, file: firmware === "qmk" ? "keymap.c" : "glove80.keymap", anchor, source, refersToLayerIndices: false });
/** What a layout stored before D-387 holds: the code as kept source, and no layer numbers read yet. */
const stored = (layout: Layout, block: Passthrough): Layout => ({ ...layout, passthrough: [...layout.passthrough, block] });
const both = async (app: Parameters<typeof backfillLayerRefs>[0]) => {
  await backfillLayerRefs(app, () => {});
  return backfillConditionalLayers(app, () => {});
};

const FN = (body: string) => `layer_state_t layer_state_set_user(layer_state_t state) {\n${body}\n}`;

describe("a Moonlander layout with tri-layer code kept as source", () => {
  const load = async () => (await importOryxSource(FIXTURE_DIR, (await moonlander()).definition)).layout;

  test("the call becomes a condition and the function leaves the kept code, in one revision that changes nothing else", async () => {
    const fresh = await load();
    const { app, id } = store("bk", stored(fresh, kept("qmk", "function:layer_state_set_user", FN("  return update_tri_layer_state(state, 1, 2, 3);"))));
    const out = await both(app);
    expect(out.map((o) => o.status)).toEqual(["written"]);
    const view = getLayout(app, id);
    expect(view.document.conditionalLayers).toEqual([{ id: "cond-layer-3", ifLayerIds: ["layer-1", "layer-2"], thenLayerId: "layer-3" }]);
    expect(view.document.passthrough.map((p) => p.anchor)).toEqual(fresh.passthrough.map((p) => p.anchor));
    expect(view.document.layers).toEqual(fresh.layers);
    expect(listRevisions(app, id).map((r) => r.summary)).toEqual(["Read the conditional layers in the kept code", "Read the layer numbers in the kept code", "Imported"]);
    closeApp(app);
  });

  test("the generated firmware makes the same calls, so it is the same build and a reorder renumbers it", async () => {
    const fresh = await load();
    const before = stored(fresh, kept("qmk", "function:layer_state_set_user", FN("  state = update_tri_layer_state(state, 1, 2, 3);\n  return state;")));
    const { app, id } = store("bk", before);
    await both(app);
    const after = getLayout(app, id).document;
    const board = (await moonlander()).definition;
    const text = (l: Layout) => generateQmkSource({ layout: l, board, revisionId: "rev_T" }).files.find((f) => f.path === "keymap.c")?.content ?? "";
    const calls = (t: string) => t.match(/update_tri_layer_state\(state, \d+, \d+, \d+\)/g);
    expect(calls(text(after))).toEqual(calls(text(before)));
    expect(sameBuild(getLayout(app, id).document, getLayout(app, id).document)).toBe(true);

    const moved = checkChange(app, id, { ops: [{ op: "moveLayer", layerId: "layer-3", afterLayerId: "layer-0" }] });
    expect(moved.errors).toEqual([]);
    closeApp(app);
  });

  test("a second run writes nothing", async () => {
    const { app, id } = store("bk", stored(await load(), kept("qmk", "function:layer_state_set_user", FN("  return update_tri_layer_state(state, 1, 2, 3);"))));
    await both(app);
    const head = getLayout(app, id).revision.id;
    expect((await backfillConditionalLayers(app, () => {})).map((o) => o.status)).toEqual(["unchanged"]);
    expect(getLayout(app, id).revision.id).toBe(head);
    closeApp(app);
  });

  test("a function that does more than the call is left as it is", async () => {
    const { app, id } = store("bk", stored(await load(), kept("qmk", "function:layer_state_set_user", FN("  state = update_tri_layer_state(state, 1, 2, 3);\n  if (layer_state_cmp(state, 3)) { tap_code(KC_A); }\n  return state;"))));
    const { lines, log } = quiet();
    await backfillLayerRefs(app, () => {});
    expect((await backfillConditionalLayers(app, log)).map((o) => o.status)).toEqual(["unchanged"]);
    expect(getLayout(app, id).document.conditionalLayers).toEqual([]);
    expect(lines).toEqual([]);
    closeApp(app);
  });

  test("without the layer numbers read first, nothing is trusted and nothing is written", async () => {
    const { app, id } = store("bk", stored(await load(), kept("qmk", "function:layer_state_set_user", FN("  return update_tri_layer_state(state, 1, 2, 3);"))));
    expect((await backfillConditionalLayers(app, () => {})).map((o) => o.status)).toEqual(["unchanged"]);
    expect(getLayout(app, id).document.conditionalLayers).toEqual([]);
    closeApp(app);
  });
});

describe("the Glove80 with a conditional_layers container kept as source", () => {
  const CONTAINER = `conditional_layers {\n    compatible = "zmk,conditional-layers";\n    tri_layer {\n        if-layers = <LOWER MAGIC>;\n        then-layer = <3>;\n    };\n};`;
  const load = async () => (await importZmkSource(TEMPLATE_FIXTURE, (await glove80()).definition)).layout;

  test("becomes a condition, and the define it used is still renumbered with the layers", async () => {
    const fresh = await load();
    const { app, id } = store("g80", stored(fresh, kept("zmk", "root:conditional_layers", CONTAINER)));
    expect((await both(app)).map((o) => o.status)).toEqual(["written"]);
    const doc = getLayout(app, id).document;
    expect(doc.conditionalLayers).toEqual([{ id: "tri-layer", ifLayerIds: ["lower-layer", "magic-layer"], thenLayerId: "factory-test-layer" }]);
    expect(doc.passthrough.some((p) => p.anchor.startsWith("root:"))).toBe(false);
    const board = await glove80();
    const text = generateZmkSource({ layout: doc, board: board.definition, geometry: board.geometry, revisionId: "rev_T" }).files[0]?.content ?? "";
    expect(text).toContain("if-layers = <1 2>;");
    expect(text).toContain("then-layer = <3>;");
    closeApp(app);
  });

  test("a container with a child keyloom can't model is left as it is", async () => {
    const wide = CONTAINER.replace("<LOWER MAGIC>", "<0 1 2>");
    const { app, id } = store("g80", stored(await load(), kept("zmk", "root:conditional_layers", wide)));
    await backfillLayerRefs(app, () => {});
    expect((await backfillConditionalLayers(app, () => {})).map((o) => o.status)).toEqual(["unchanged"]);
    expect(getLayout(app, id).document.conditionalLayers).toEqual([]);
    closeApp(app);
  });
});

describe("a layout it can't read", () => {
  test("is logged and left as it is, and the others are still read", async () => {
    const fresh = (await importOryxSource(FIXTURE_DIR, (await moonlander()).definition)).layout;
    const good = stored(fresh, kept("qmk", "function:layer_state_set_user", FN("  return update_tri_layer_state(state, 1, 2, 3);")));
    const { app, id } = store("good", good);
    createLayout(app.db, { name: "orphan", layout: { ...good, boardId: "nobody/nothing" }, summary: "Imported", origin: "import" });
    await backfillLayerRefs(app, () => {});
    const { lines, log } = quiet();
    const out = await backfillConditionalLayers(app, log);
    expect(out.map((o) => [o.name, o.status])).toEqual([["good", "written"], ["orphan", "failed"]]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"orphan"');
    expect(listRevisions(app, id)).toHaveLength(3);
    closeApp(app);
  });
});
