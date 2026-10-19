// `keyloom layout export` and the import it round-trips through (10, D-032). The acceptance check is the
// round trip: every layer, binding, macro, tap dance, combo, conditional layer, hold-tap profile, setting
// and passthrough comes back unchanged in a second data directory.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  type App, applyOps, closeApp, getLayout, importLayout, listLayouts, openApp,
} from "../../src/app/index.ts";
import { runCli } from "../../src/cli/main.ts";
import type { Io } from "../../src/cli/output.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { deepEqual } from "../../src/layout/equal.ts";
import { bindingFunctions } from "../../src/layout/functions.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { createLayout } from "../../src/persistence/layouts.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { tempDir } from "../helpers/tmp.ts";

const BOARD = "zsa/moonlander";
const opened: App[] = [];

afterEach(() => {
  for (const app of opened.splice(0)) closeApp(app);
});

function open(dataDir = tempDir()): App {
  const app = openApp({ dataDir });
  opened.push(app);
  return app;
}

type Result = { code: number; out: string; err: string };
async function cli(args: string[], dataDir: string): Promise<Result> {
  let out = "";
  let err = "";
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: false };
  const code = await runCli([...args, "--data-dir", dataDir], io);
  return { code, out, err };
}

/** A Moonlander layout that uses every document field, so a round trip that drops one fails by name. */
function richLayout(base: Layout): Layout {
  const [baseLayer, symbol, media] = base.layers;
  if (!baseLayer || !symbol || !media) throw new Error("the fixture needs three layers");
  const bindings = [...baseLayer.bindings];
  bindings[0] = { kind: "holdTap", tap: { code: "A" }, hold: { mods: ["LCTL"] }, profileId: "htp_home" };
  bindings[1] = { kind: "macro", macroId: "mac_hello" };
  bindings[2] = { kind: "tapDance", tapDanceId: "td_escape" };
  bindings[3] = { kind: "layer", action: "momentary", layerId: symbol.id };
  bindings[4] = { kind: "modifier", mods: ["LSFT"] };
  bindings[5] = { kind: "key", code: "A", mods: ["LSFT"] };
  bindings[6] = { kind: "native", firmware: "qmk", source: "LCTL_T(KC_A)", label: "LCTL_T", layerRefs: [{ start: 0, end: 6, layerId: symbol.id }] };
  bindings[7] = { kind: "transparent" };
  bindings[8] = { kind: "none" };
  return {
    ...base,
    layers: [
      { ...baseLayer, id: "zeta", name: "Zeta", bindings, shortLabel: "ZE", color: 3, lighting: { layer: [10, 20, 30], keys: { "0": [1, 2, 3] } } },
      { ...symbol, id: "alpha", name: "Alpha" },
      { ...media, id: "mid", name: "Mid" },
    ],
    macros: [{ id: "mac_hello", name: "hello", steps: [{ op: "text", text: "Hi" }, { op: "tap", code: "ENTER", mods: ["LSFT"] }, { op: "waitMs", ms: 25 }] }],
    tapDances: [{
      id: "td_escape", name: "escape copy", tap: { kind: "key", code: "ESCAPE" }, doubleTap: { kind: "key", code: "C" },
      tapThenHold: { kind: "modifier", mods: ["LGUI"] }, termMs: 180,
    }],
    combos: [{ id: "combo_escape", name: "escape chord", positions: [0, 1], layerIds: "all", output: { kind: "key", code: "ESCAPE" }, timeoutMs: 40 }],
    conditionalLayers: [{ id: "tri", ifLayerIds: ["alpha", "mid"], thenLayerId: "zeta" }],
    holdTapProfiles: [{ id: "htp_home", name: "home row", firmware: "qmk", options: { tappingTerm: 200, quickTap: true, flavors: [1, 2] } }],
    settings: [{ firmware: "qmk", key: "TAPPING_TERM", value: 200 }, { firmware: "qmk", key: "COMBO_TERM", value: 40 }],
    passthrough: [{
      firmware: "qmk", file: "keymap.c", anchor: "// keyloom", source: "#define KEYLOOM 1\n", refersToLayerIndices: true,
      layerRefs: [{ start: 3, end: 9, layerId: "alpha" }], unprovable: [{ line: 4, text: "layer_state_set_user(...)" }],
    }],
  };
}

/** A revision that changes one key of `Rich`, licensing the function it replaces. */
function changeKey(app: App, id: string, position: number, code: string): string {
  const view = getLayout(app, id);
  const layer = view.document.layers[0];
  if (!layer) throw new Error("Rich has no layers");
  const old = layer.bindings[position];
  const lost = old ? bindingFunctions(old, view.document.tapDances) : [];
  const ops: ChangeOp[] = [
    ...lost.map((function_) => ({ op: "dropFunction" as const, function: function_, reason: "test edit" })),
    { op: "setBinding", at: { layerId: layer.id, position }, binding: { kind: "key", code } },
  ];
  return applyOps(app, id, { baseRevisionId: view.revision.id, ops, summary: `Layer 0, key ${position + 1}: ${code}` }).revisionId;
}

/** A source app holding `Rich`, one revision past a change to key 21, and the revision before it. */
async function rich(): Promise<{ app: App; id: string; first: string; head: string }> {
  const app = open();
  const imported = await importLayout(app, { board: BOARD, source: FIXTURE_DIR });
  const layout = richLayout(getLayout(app, imported.layoutId).document);
  const created = createLayout(app.db, { name: "Rich", layout, summary: "test fixture", origin: "import" });
  const first = getLayout(app, created.layout.id).revision.id;
  const head = changeKey(app, created.layout.id, 20, "F17");
  return { app, id: created.layout.id, first, head };
}

describe("keyloom layout export", () => {
  test("round trip: the file holds the whole layout and config new --from import gives it back key for key", async () => {
    const { app, id, head } = await rich();
    const before = getLayout(app, id).document;
    const file = join(tempDir(), "rich.json");

    const exported = await cli(["layout", "export", "Rich", "--out", file, "--format", "json"], app.dataDir);
    expect(exported.code).toBe(0);
    expect(JSON.parse(exported.out)).toMatchObject({
      schema_version: 1, layout_id: id, name: "Rich", board_id: BOARD, revision_id: head, path: file,
    });

    const written = (await Bun.file(file).json()) as { kind: string; schema_version: number; board_id: string; layout_name: string; revision_id: string; layout: Layout };
    expect(written).toMatchObject({ kind: "keyloom-layout", schema_version: 1, board_id: BOARD, layout_name: "Rich", revision_id: head });
    expect(deepEqual(written.layout, before)).toBe(true);

    const dest = open();
    const readBack = await cli(["config", "new", "Copy", "--from", "import", file, "--board", BOARD, "--format", "json"], dest.dataDir);
    expect(readBack.code).toBe(0);
    const copyId = (JSON.parse(readBack.out) as { config: { id: string } }).config.id;
    const after = getLayout(dest, copyId).document;

    expect(deepEqual(after, written.layout)).toBe(true);
    expect(deepEqual(after, before)).toBe(true);
    // Named so a dropped field says which one.
    expect(after.macros).toEqual(before.macros);
    expect(after.tapDances).toEqual(before.tapDances);
    expect(after.combos).toEqual(before.combos);
    expect(after.conditionalLayers).toEqual(before.conditionalLayers);
    expect(after.holdTapProfiles).toEqual(before.holdTapProfiles);
    expect(after.settings).toEqual(before.settings);
    expect(after.passthrough).toEqual(before.passthrough);
    expect(after.layers.map((l) => l.id)).toEqual(["zeta", "alpha", "mid"]);
    for (const [index, layer] of before.layers.entries()) expect(after.layers[index]?.bindings).toEqual(layer.bindings);
  });

  test("a keyloom document names the board it is for, and another --board is refused without making a config", async () => {
    const { app } = await rich();
    const file = join(tempDir(), "rich.json");
    expect((await cli(["layout", "export", "Rich", "--out", file], app.dataDir)).code).toBe(0);

    const dest = open();
    const refused = await cli(["config", "new", "Wrong", "--from", "import", file, "--board", "foostan/corne"], dest.dataDir);
    expect(refused.code).toBe(2);
    expect(refused.err).toContain("is a layout for zsa/moonlander, not foostan/corne");
    expect(refused.err).toContain("--board zsa/moonlander");
    expect(listLayouts(dest)).toHaveLength(0);

    const accepted = await cli(["config", "new", "Right", "--from", "import", file, "--board", BOARD], dest.dataDir);
    expect(accepted.code).toBe(0);
    expect(listLayouts(dest).map((l) => l.name)).toEqual(["Right"]);
  });

  test("a truncated, newer or wrongly typed keyloom document is refused and makes no config", async () => {
    const dir = tempDir();
    const cases: Array<[string, string]> = [
      ["truncated", '{"kind":"keyloom-layout","schema_version":1,"board_id":"zsa/moonlander","layout":'],
      ["wrong type", JSON.stringify({ kind: "keyloom-layout", schema_version: 1, board_id: 7, layout: {} })],
      ["newer", JSON.stringify({ kind: "keyloom-layout", schema_version: 2, board_id: BOARD, layout: {} })],
      ["no layout", JSON.stringify({ kind: "keyloom-layout", schema_version: 1, board_id: BOARD })],
    ];
    for (const [index, [name, text]] of cases.entries()) {
      const file = join(dir, `bad-${index}.json`);
      await Bun.write(file, text);
      const dest = open();
      const refused = await cli(["config", "new", name, "--from", "import", file, "--board", BOARD], dest.dataDir);
      expect(refused.code).toBe(2);
      expect(refused.err).toContain("keyloom layout document");
      expect(listLayouts(dest)).toHaveLength(0);
    }
  });

  test("--rev exports that revision; a missing layout or revision is exit 3, and --out is required", async () => {
    const { app, id, first, head } = await rich();
    const oldFile = join(tempDir(), "old.json");
    const old = await cli(["layout", "export", id, "--rev", first, "--out", oldFile, "--format", "json"], app.dataDir);
    expect(old.code).toBe(0);
    const oldDoc = (await Bun.file(oldFile).json()) as { revision_id: string; layout: Layout };
    expect(oldDoc.revision_id).toBe(first);
    expect(oldDoc.layout.layers[0]?.bindings[20]).not.toEqual({ kind: "key", code: "F17" });

    const headFile = join(tempDir(), "head.json");
    expect((await cli(["layout", "export", id, "--out", headFile], app.dataDir)).code).toBe(0);
    expect(((await Bun.file(headFile).json()) as { revision_id: string }).revision_id).toBe(head);

    expect((await cli(["layout", "export", "nope", "--out", oldFile], app.dataDir)).code).toBe(3);
    expect((await cli(["layout", "export", id, "--rev", "rev_nope", "--out", oldFile], app.dataDir)).code).toBe(3);
    const noOut = await cli(["layout", "export", id], app.dataDir);
    expect(noOut.code).toBe(2);
    expect(noOut.err).toContain("--out");
  });

  test("--out overwrites a file whole; a missing folder or a folder target is a usage error, and a failed write keeps the old file", async () => {
    const { app } = await rich();
    const dir = tempDir();
    const file = join(dir, "layout.json");
    await Bun.write(file, "old");
    expect((await cli(["layout", "export", "Rich", "--out", file], app.dataDir)).code).toBe(0);
    expect(((await Bun.file(file).json()) as { kind: string }).kind).toBe("keyloom-layout");

    const missing = await cli(["layout", "export", "Rich", "--out", join(dir, "no", "such", "layout.json")], app.dataDir);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("doesn't exist");

    const folder = await cli(["layout", "export", "Rich", "--out", dir], app.dataDir);
    expect(folder.code).toBe(2);
    expect(folder.err).toContain("is a folder");

    const locked = tempDir();
    const kept = join(locked, "layout.json");
    await Bun.write(kept, "old");
    const root = (process as { getuid?: () => number }).getuid?.() === 0;
    if (!root) {
      chmodSync(locked, 0o500);
      try {
        const failed = await cli(["layout", "export", "Rich", "--out", kept], app.dataDir);
        expect(failed.code).toBe(2);
        expect(await Bun.file(kept).text()).toBe("old");
        expect(readdirSync(locked)).toEqual(["layout.json"]);
      } finally {
        chmodSync(locked, 0o700);
      }
    }
  });
});
