// The real thing: a generated keymap run on ZMK's native_posix_64 build in Docker, for the Glove80 (MoErgo's
// image) and the Corne (ZMK's west image). Gated, because it needs Docker, the images and, for the Corne,
// the west workspace a real build keeps (a first run downloads Zephyr). About 7 s per Glove80 run and 25 s
// per Corne run once those exist:
//   KEYLOOM_DOCKER_TESTS=zmk bun test test/firmware/zmk/emulate-docker.test.ts   (KEYLOOM_DOCKER_TESTS=1 runs it too)
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { checkoutDirFor } from "../../../src/app/firmware.ts";
import { loadBoardDir } from "../../../src/boards/load.ts";
import { parseScript } from "../../../src/firmware/emulate/script.ts";
import { LogSink } from "../../../src/firmware/toolchain/run.ts";
import { emulateZmk } from "../../../src/firmware/zmk/emulate.ts";
import { generateZmkSource } from "../../../src/firmware/zmk/generate.ts";
import { importZmkSource } from "../../../src/firmware/zmk/import.ts";
import { cacheDir } from "../../../src/persistence/paths.ts";
import { tempDir } from "../../helpers/tmp.ts";
import { STYLE_FIXTURE } from "../../helpers/zmk.ts";

const gated = ["1", "zmk"].includes(process.env.KEYLOOM_DOCKER_TESTS ?? "") ? describe : describe.skip;
const TIMEOUT = 280_000;
const ROOT = `${import.meta.dir}/../../..`;

async function emulate(boardDir: string, keymap: string, script: string) {
  const board = await loadBoardDir(`${ROOT}/${boardDir}`);
  const { layout } = await importZmkSource(keymap, board.definition);
  const rev = board.definition.revisions[0];
  const source = generateZmkSource({
    layout, board: board.definition, geometry: board.geometry, revisionId: "rev_test",
    ...(rev?.build.kind === "zmk-west-docker" ? { keymapName: rev.build.keymapName } : {}),
  });
  const dir = tempDir();
  const slug = board.definition.id.replace("/", "-");
  const log = new LogSink(join(dir, "emulate.log"));
  try {
    // A fresh work folder, so a saved run from an earlier test run can't stand in for this one.
    return await emulateZmk({
      board: board.definition, boardRevision: "default", source, events: parseScript(script, { keyCount: board.definition.keyCount }),
      checkoutDir: checkoutDirFor(board), workDir: join(dir, "work"), imageContextDir: join(cacheDir(), "images", slug), log, containerName: `keyloom-emu-test-${process.pid}`,
    });
  } finally {
    log.close();
  }
}

gated("the Glove80 (moergo-sc/zmk in the MoErgo image)", () => {
  const run = (script: string) => emulate("boards/moergo/glove80", STYLE_FIXTURE, script);

  test("a tapped letter is W down and then nothing down, 40 ms apart, and types w", async () => {
    const r = await run("tap 25");
    expect(r.reports).toEqual([
      { at: 0, kind: "keyboard", mods: [], keys: ["W"] },
      { at: 40, kind: "keyboard", mods: [], keys: [] },
    ]);
    expect(r.text).toBe("w");
    expect(r.warnings.join("\n")).toContain("&bt");
  }, TIMEOUT);

  test("a home-row mod held past its tapping term shifts the next key: Left Shift alone at the term, then with U", async () => {
    const r = await run("hold 39 300 then tap 30");
    expect(r.reports).toEqual([
      { at: 281, kind: "keyboard", mods: ["LSFT"], keys: [] },
      { at: 300, kind: "keyboard", mods: ["LSFT"], keys: ["U"] },
      { at: 340, kind: "keyboard", mods: ["LSFT"], keys: [] },
      { at: 360, kind: "keyboard", mods: [], keys: [] },
    ]);
    expect(r.text).toBe("U");
  }, TIMEOUT);

  test("a layer-tap held past its term puts the next key on the layer: key 2 is volume up there, not a letter", async () => {
    const r = await run("hold 55 300 then tap 2");
    const consumer = r.reports.filter((x) => x.kind === "consumer");
    expect(consumer.map((x) => x.usages)).toEqual([["AUDIO_VOL_UP"], []]);
    expect(r.reports.filter((x) => x.kind === "keyboard").every((x) => x.keys.length === 0)).toBe(true);
    expect(r.text).toBe("");
  }, TIMEOUT);
});

gated("the Corne (upstream ZMK in zmk-build-arm)", () => {
  const run = (script: string) => emulate("boards/foostan/corne", `${ROOT}/test/fixtures/zmk/corne/corne.keymap`, script);

  test("a tapped letter is W down and then nothing down", async () => {
    const r = await run("tap 3");
    expect(r.reports).toEqual([
      { at: 0, kind: "keyboard", mods: [], keys: ["W"] },
      { at: 40, kind: "keyboard", mods: [], keys: [] },
    ]);
    expect(r.text).toBe("w");
  }, TIMEOUT);

  test("a home-row Alt held past its tapping term turns the next key into Alt+U", async () => {
    const r = await run("hold 15 300 then tap 8");
    expect(r.reports).toEqual([
      { at: 281, kind: "keyboard", mods: ["LALT"], keys: [] },
      { at: 300, kind: "keyboard", mods: ["LALT"], keys: ["U"] },
      { at: 340, kind: "keyboard", mods: ["LALT"], keys: [] },
      { at: 360, kind: "keyboard", mods: [], keys: [] },
    ]);
    expect(r.text).toBe("");
  }, TIMEOUT);

  test("a momentary layer key makes key 3 the number 2, and a media key sends a consumer report", async () => {
    const layer = await run("hold 38 100 then tap 3");
    expect(layer.reports.find((x) => x.kind === "keyboard" && x.keys.length > 0)).toMatchObject({ keys: ["N2"] });
    expect(layer.text).toBe("2");
    const media = await run("tap 36");
    expect(media.reports.map((x) => (x.kind === "consumer" ? x.usages : ["keyboard"]))).toEqual([["AUDIO_VOL_UP"], []]);
  }, TIMEOUT);
});
