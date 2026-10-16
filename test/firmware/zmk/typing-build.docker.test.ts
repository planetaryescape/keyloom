// The real thing: hands-free builds of the Glove80 (MoErgo's Nix image) and the Corne (ZMK's west image) with the typing lab's stream
// in keyloom-zmk, checked by reading the UF2 for the protocol strings that only typing.c carries. Gated: Docker, the images, about
// 20 s (Glove80) and a few minutes (Corne) once they exist:
//   KEYLOOM_DOCKER_TESTS=zmk-typing bun test test/firmware/zmk/typing-build.docker.test.ts
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { checkoutDirFor } from "../../../src/app/firmware.ts";
import { loadBoardDir } from "../../../src/boards/load.ts";
import { LogSink } from "../../../src/firmware/toolchain/run.ts";
import { zmkRevision } from "../../../src/firmware/zmk/board-config.ts";
import { buildZmkWest } from "../../../src/firmware/zmk/build-west.ts";
import { buildZmk } from "../../../src/firmware/zmk/build.ts";
import { generateZmkSource } from "../../../src/firmware/zmk/generate.ts";
import { importZmkSource } from "../../../src/firmware/zmk/import.ts";
import { cacheDir } from "../../../src/persistence/paths.ts";
import { tempDir } from "../../helpers/tmp.ts";
import { TEMPLATE_FIXTURE } from "../../helpers/zmk.ts";

const gated = ["1", "zmk-typing"].includes(process.env.KEYLOOM_DOCKER_TESTS ?? "") ? describe : describe.skip;
const ROOT = `${import.meta.dir}/../../..`;
const BUILD = "bld_01JABCDEFGHJKMNPQRSTVWXYZ0";
const TIMEOUT = 40 * 60_000;

/** UF2 payloads end to end, so a string the linker split across two blocks is whole again. */
function payload(uf2: Uint8Array): string {
  const view = new DataView(uf2.buffer, uf2.byteOffset, uf2.byteLength);
  const parts: Uint8Array[] = [];
  for (let off = 0; off + 512 <= uf2.length; off += 512) parts.push(uf2.subarray(off + 32, off + 32 + Math.min(view.getUint32(off + 16, true), 476)));
  return Buffer.concat(parts).toString("latin1");
}

gated("hands-free ZMK builds carry the typing stream", () => {
  test("the Glove80 firmware contains typing.c's commands and its event format", async () => {
    const board = await loadBoardDir(`${ROOT}/boards/moergo/glove80`);
    const { layout } = await importZmkSource(TEMPLATE_FIXTURE, board.definition);
    const rev = zmkRevision(board.definition);
    const source = generateZmkSource({ layout, board: board.definition, geometry: board.geometry, revisionId: "rev_test", handsFree: { buildId: BUILD, config: rev.flash.handsFree as never } });
    const dir = tempDir();
    const log = new LogSink(join(dir, "build.log"));
    await buildZmk({
      board: board.definition, source, checkoutDir: checkoutDirFor(board), imageContextDir: join(cacheDir(), "images", "moergo-glove80"), artifactPath: join(dir, "out.uf2"), log,
      containerName: `keyloom-typing-glove80-${process.pid}`,
    });
    log.close();
    const text = payload(await Bun.file(join(dir, "out.uf2")).bytes());
    expect(text).toContain("KLTYPE START");
    expect(text).toContain("KLTYPE ON %u");
    expect(text).toContain("E %u %u %u %u");
    console.log(`keyloom: Glove80 hands-free build carries the typing stream; ${text.length} payload bytes`);
  }, TIMEOUT);

  test("the Corne's central half carries it and its peripheral half does not", async () => {
    const board = await loadBoardDir(`${ROOT}/boards/foostan/corne`);
    const { layout } = await importZmkSource(`${ROOT}/test/fixtures/zmk/corne`, board.definition);
    const rev = zmkRevision(board.definition);
    const source = generateZmkSource({
      layout, board: board.definition, geometry: board.geometry, revisionId: "rev_test", keymapName: rev.build.kind === "zmk-west-docker" ? rev.build.keymapName : "corne",
      handsFree: { buildId: BUILD, config: rev.flash.handsFree as never },
    });
    const dir = tempDir();
    const log = new LogSink(join(dir, "build.log"));
    await buildZmkWest({
      board: board.definition, source, checkoutDir: checkoutDirFor(board), imageContextDir: join(dir, "image"), artifactPath: join(dir, "out.zip"), log,
      containerName: `keyloom-typing-corne-${process.pid}`,
    });
    log.close();
    const images = unzipSync(await Bun.file(join(dir, "out.zip")).bytes());
    const texts = Object.fromEntries(Object.entries(images).map(([name, bytes]) => [name, payload(bytes)]));
    console.log(`keyloom: Corne images ${Object.keys(texts).join(", ")}`);
    const carrying = Object.entries(texts).filter(([, t]) => t.includes("KLTYPE START")).map(([n]) => n);
    expect(carrying).toHaveLength(1);
    expect(Object.keys(texts)).toHaveLength(2);
  }, TIMEOUT);
});
