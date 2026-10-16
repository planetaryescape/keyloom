// QMK's stock keymaps are often only a keymap.json in the Configurator format (D-352). It imports through the keymap.c path.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadBoardDir } from "../../../src/boards/load.ts";
import { ImportError, importOryxSource } from "../../../src/firmware/qmk/import.ts";
import { keymapJsonToC } from "../../../src/firmware/qmk/keymap-json.ts";
import { generateQmkSource } from "../../../src/firmware/qmk/generate.ts";
import { templateCopy } from "../../helpers/board-recipes.ts";

const FIXTURE = join(import.meta.dir, "../../fixtures/qmk/charybdis-4x6-default");

// The Charybdis 4x6's facts as far as the importer reads them: 56 keys, the home row on positions 24 to 35.
async function charybdis() {
  const { definition } = await loadBoardDir(await templateCopy("qmk"));
  const all = Array.from({ length: 56 }, (_, p) => p);
  return { ...definition, keyCount: 56, hands: { left: all.slice(0, 28), right: all.slice(28) }, rows: { home: all.slice(24, 36), rest: [...all.slice(0, 24), ...all.slice(36)] }, fingers: {}, mirror: {} };
}

describe("importing a QMK keymap.json", () => {
  test("the Charybdis 4x6 default keymap.json imports from its folder, with every layer and keycode read", async () => {
    const { layout, report, suggestedName } = await importOryxSource(FIXTURE, await charybdis());
    expect(suggestedName).toBe("charybdis-4x6-default");
    expect(report).toMatchObject({ layers: 3, keysPerLayer: 56 });
    const base = layout.layers[0]!.bindings;
    expect(base[0]).toEqual({ kind: "key", code: "ESCAPE" });
    expect(base[49]).toMatchObject({ kind: "layer", action: "momentary", layerId: "layer-1" });
    expect(base[52]).toMatchObject({ kind: "layer", action: "momentary", layerId: "layer-2" });
    expect(layout.layers[1]!.bindings[0]).toEqual({ kind: "transparent" });
    // QK_BOOT, EE_CLR and the RGB matrix keys have no model; they are kept as written.
    expect(report.native.map((n) => n.source)).toContain("QK_BOOT");
    // Nothing but the keymap is in this keymap.json, so nothing of it is written back beside the generated keymap.c.
    expect(layout.passthrough.some((p) => p.file === "keymap.json")).toBe(false);
  });

  test("the file itself imports too, under the name it gives itself", async () => {
    const { report, suggestedName } = await importOryxSource(join(FIXTURE, "keymap.json"), await charybdis());
    expect(report.layers).toBe(3);
    expect(suggestedName).toBe("default");
  });

  test("the generated keymap.c carries the layers, and a keymap.json's other fields stay build input", async () => {
    const { keymapC, rest } = keymapJsonToC(JSON.stringify({ keyboard: "x", layout: "LAYOUT", layers: [["KC_A", "LT(1, KC_B)"]], config: { features: { mousekey: true } } }), "keymap.json");
    expect(keymapC).toContain("[0] = LAYOUT(KC_A, LT(1, KC_B))");
    expect(JSON.parse(rest ?? "{}")).toEqual({ config: { features: { mousekey: true } } });
    const board = await charybdis();
    const { layout } = await importOryxSource(FIXTURE, board);
    const files = generateQmkSource({ layout, board, revisionId: "rev_T" }).files.map((f) => f.path);
    expect(files).toContain("keymap.c");
  });

  test("a keycode that would split or end the LAYOUT call is refused by name", () => {
    expect(() => keymapJsonToC(JSON.stringify({ layout: "LAYOUT", layers: [["KC_A, KC_B"]] }), "keymap.json")).toThrow(ImportError);
    expect(() => keymapJsonToC(JSON.stringify({ layout: "LAYOUT", layers: [["KC_A)"]] }), "keymap.json")).toThrow('layer 0 key 1 is "KC_A)"');
    expect(() => keymapJsonToC(JSON.stringify({ layers: [["KC_A"]] }), "keymap.json")).toThrow("needs \"layout\"");
  });
});
