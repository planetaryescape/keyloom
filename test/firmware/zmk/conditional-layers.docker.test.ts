// The real thing: a conditional layer generated into a Glove80 keymap and run on MoErgo's ZMK in Docker (D-387). Gated like
// emulate-docker.test.ts:
//   KEYLOOM_DOCKER_TESTS=zmk bun test test/firmware/zmk/conditional-layers.docker.test.ts
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { checkoutDirFor } from "../../../src/app/firmware.ts";
import { loadBoardDir } from "../../../src/boards/load.ts";
import { parseScript } from "../../../src/firmware/emulate/script.ts";
import { LogSink } from "../../../src/firmware/toolchain/run.ts";
import { emulateZmk } from "../../../src/firmware/zmk/emulate.ts";
import { generateZmkSource } from "../../../src/firmware/zmk/generate.ts";
import { importZmkSource } from "../../../src/firmware/zmk/import.ts";
import { applyOps } from "../../../src/layout/apply-ops.ts";
import type { ChangeOp } from "../../../src/layout/change.ts";
import type { Layout } from "../../../src/layout/schema.ts";
import { cacheDir } from "../../../src/persistence/paths.ts";
import { tempDir } from "../../helpers/tmp.ts";
import { TEMPLATE_FIXTURE } from "../../helpers/zmk.ts";

const gated = ["1", "zmk"].includes(process.env.KEYLOOM_DOCKER_TESTS ?? "") ? describe : describe.skip;
const TIMEOUT = 280_000;
const ROOT = `${import.meta.dir}/../../..`;

const edit = (ops: ChangeOp[]) => (layout: Layout): Layout => {
  const r = applyOps(layout, ops);
  if (!r.ok) throw new Error(r.error.message);
  return r.layout;
};

async function emulate(script: string, change: (layout: Layout) => Layout) {
  const board = await loadBoardDir(`${ROOT}/boards/moergo/glove80`);
  const layout = change((await importZmkSource(TEMPLATE_FIXTURE, board.definition)).layout);
  const source = generateZmkSource({ layout, board: board.definition, geometry: board.geometry, revisionId: "rev_test" });
  const dir = tempDir();
  const log = new LogSink(join(dir, "emulate.log"));
  try {
    return await emulateZmk({
      board: board.definition, boardRevision: "default", source, events: parseScript(script, { keyCount: board.definition.keyCount }),
      checkoutDir: checkoutDirFor(board), workDir: join(dir, "work"), imageContextDir: join(cacheDir(), "images", board.definition.id.replace("/", "-")), log, containerName: `keyloom-emu-cond-${process.pid}`,
    });
  } finally {
    log.close();
  }
}

// Holding Lower (key 55, a tap dance whose hold is &mo LOWER) and Magic (key 65, &magic MAGIC 0) together turns on the factory test layer,
// the top one, where key 1 is 0; on Magic alone key 1 is &bt BT_CLR, which types nothing.
const BOTH = "hold 55 300 then hold 65 300 then tap 1";
const condition = edit([{ op: "upsertConditionalLayer", conditionalLayer: { id: "tri", ifLayerIds: ["lower-layer", "magic-layer"], thenLayerId: "factory-test-layer" } }]);
// Magic goes from 2 to 1 and Lower from 1 to 2, so the numbers in the condition, the kept defines and the kept behaviours all change, and the factory layer stays on top.
const swapLowerAndMagic = edit([{ op: "moveLayer", layerId: "magic-layer", afterLayerId: "default-layer" }]);

gated("a conditional layer on the Glove80 (moergo-sc/zmk in the MoErgo image)", () => {
  test("without the condition, holding Lower and Magic together leaves Magic on top and types nothing", async () => {
    const r = await emulate(BOTH, (l) => l);
    expect(r.text).toBe("");
  }, TIMEOUT);

  test("with it, holding both turns the third layer on: key 1 is 0", async () => {
    const r = await emulate(BOTH, condition);
    expect(r.text).toBe("0");
  }, TIMEOUT);

  test("holding only one of the two does not", async () => {
    const r = await emulate("hold 55 300 then tap 1", condition);
    expect(r.text).not.toBe("0");
  }, TIMEOUT);

  test("after the layers are reordered the condition still turns the same layer on", async () => {
    const r = await emulate(BOTH, (l) => swapLowerAndMagic(condition(l)));
    expect(r.text).toBe("0");
  }, TIMEOUT);
});
