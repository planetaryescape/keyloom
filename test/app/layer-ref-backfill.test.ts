// Layouts stored before layer numbers were read (D-360) get them read at startup, as one revision (D-361).
import { describe, expect, test } from "bun:test";
import { backfillLayerRefs, checkChange, closeApp, getLayout, importLayout, listRevisions, openApp } from "../../src/app/index.ts";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { importZmkSource } from "../../src/firmware/zmk/import.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import type { Binding, Layout } from "../../src/layout/schema.ts";
import { createLayout } from "../../src/persistence/layouts.ts";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";
import { tempDir } from "../helpers/tmp.ts";
import { TEMPLATE_FIXTURE, glove80 } from "../helpers/zmk.ts";

/** A layout as it was stored before the importers read layer numbers: no `layerRefs` or `unprovable` anywhere. */
function asStoredBefore(layout: Layout): Layout {
  const strip = (b: Binding): Binding => {
    if (b.kind !== "native") return b;
    const { layerRefs: _r, unprovable: _u, ...rest } = b;
    return rest;
  };
  return {
    ...layout,
    layers: layout.layers.map((l) => ({ ...l, bindings: l.bindings.map(strip) })),
    combos: layout.combos.map((c) => ({ ...c, output: strip(c.output) })),
    passthrough: layout.passthrough.map(({ layerRefs: _r, unprovable: _u, ...p }) => p),
  };
}

const store = (name: string, layout: Layout) => {
  const app = openApp({ dataDir: tempDir() });
  return { app, id: createLayout(app.db, { name, layout, summary: "Imported", origin: "import" }).layout.id };
};
const quiet = () => {
  const lines: string[] = [];
  return { lines, log: (m: string) => lines.push(m) };
};

describe("the Moonlander as it was stored", () => {
  const load = async () => {
    const board = await moonlander();
    const fresh = (await importOryxSource(FIXTURE_DIR, board.definition)).layout;
    return { fresh, legacy: asStoredBefore(fresh) };
  };
  const move: ChangeOp[] = [{ op: "moveLayer", layerId: "layer-5", afterLayerId: "layer-1" }];

  test("Move is refused before and allowed after, from one revision that changes no key", async () => {
    const { fresh, legacy } = await load();
    const { app, id } = store("bk", legacy);
    expect(checkChange(app, id, { ops: move }).errors.map((e) => e.code)).toContain("passthrough_layer_index");

    const { log } = quiet();
    expect((await backfillLayerRefs(app, log)).map((o) => o.status)).toEqual(["written"]);
    expect(checkChange(app, id, { ops: move }).errors).toEqual([]);

    const revisions = listRevisions(app, id);
    expect(revisions.map((r) => r.summary)).toEqual(["Read the layer numbers in the kept code", "Imported"]); // newest first
    const view = getLayout(app, id);
    expect(view.document.layers.map((l) => l.bindings)).toEqual(fresh.layers.map((l) => l.bindings));
    expect(view.document.passthrough).toEqual(fresh.passthrough);
    closeApp(app);
  });

  test("a second run writes nothing, and a fresh import is never rewritten", async () => {
    const { legacy } = await load();
    const { app, id } = store("bk", legacy);
    await backfillLayerRefs(app, quiet().log);
    const head = getLayout(app, id).revision.id;
    expect((await backfillLayerRefs(app, quiet().log)).map((o) => o.status)).toEqual(["unchanged"]);
    expect(getLayout(app, id).revision.id).toBe(head);
    closeApp(app);

    const dir = tempDir();
    const second = openApp({ dataDir: dir });
    const imported = await importLayout(second, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "fresh" });
    expect((await backfillLayerRefs(second, quiet().log)).map((o) => o.status)).toEqual(["unchanged"]);
    expect(listRevisions(second, imported.layoutId)).toHaveLength(1);
    closeApp(second);
  });
});

describe("the Glove80 template as it was stored", () => {
  test("Move on the factory test layer is refused before and allowed after", async () => {
    const board = await glove80();
    const fresh = (await importZmkSource(TEMPLATE_FIXTURE, board.definition)).layout;
    const { app, id } = store("g80", asStoredBefore(fresh));
    const move: ChangeOp[] = [{ op: "moveLayer", layerId: "factory-test-layer", afterLayerId: "default-layer" }];
    expect(checkChange(app, id, { ops: move }).errors.map((e) => e.code)).toContain("passthrough_layer_index");
    await backfillLayerRefs(app, quiet().log);
    expect(checkChange(app, id, { ops: move }).errors).toEqual([]);
    const lower = getLayout(app, id).document.passthrough.find((p) => p.anchor === "define:LOWER");
    expect(lower?.layerRefs).toEqual(fresh.passthrough.find((p) => p.anchor === "define:LOWER")?.layerRefs);
    // The kept tap dance reads LOWER through its define, so deleting Lower is refused, naming that line.
    const del = checkChange(app, id, { ops: [{ op: "removeLayer", layerId: "lower-layer" }] }).errors.find((e) => e.code === "passthrough_layer_index");
    expect(del?.message).toContain("define:LOWER line 1 (#define LOWER 1)");
    closeApp(app);
  });
});

describe("a layout it can't read", () => {
  test("is logged and left as it is, and the others are still read", async () => {
    const board = await moonlander();
    const legacy = asStoredBefore((await importOryxSource(FIXTURE_DIR, board.definition)).layout);
    const { app, id } = store("good", legacy);
    // A layout for a board this install doesn't have can't be opened.
    createLayout(app.db, { name: "orphan", layout: { ...legacy, boardId: "nobody/nothing" }, summary: "Imported", origin: "import" });
    const { lines, log } = quiet();
    const out = await backfillLayerRefs(app, log);
    expect(out.map((o) => [o.name, o.status])).toEqual([["good", "written"], ["orphan", "failed"]]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"orphan"');
    expect(listRevisions(app, id)).toHaveLength(2);
    closeApp(app);
  });
});
