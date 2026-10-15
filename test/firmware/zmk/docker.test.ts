// The real thing: generated source built by MoErgo's Nix build in Docker. Gated, because it needs Docker,
// the template checkout (created on first run) and the firmware image (a few minutes and ~5 GB the first
// time, about 20 s per build after):
//   KEYLOOM_DOCKER_TESTS=1 bun test test/firmware/zmk/docker.test.ts
import { describe, expect, test } from "bun:test";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { checkoutDirFor } from "../../../src/app/firmware.ts";
import { cacheDir } from "../../../src/persistence/paths.ts";
import { buildZmk } from "../../../src/firmware/zmk/build.ts";
import { generateZmkSource } from "../../../src/firmware/zmk/generate.ts";
import { importZmk, importZmkSource } from "../../../src/firmware/zmk/import.ts";
import { LogSink } from "../../../src/firmware/toolchain/run.ts";
import { inspectUf2, uf2Problem } from "../../../src/firmware/zmk/uf2.ts";
import type { Layout } from "../../../src/layout/schema.ts";
import { tempDir } from "../../helpers/tmp.ts";
import { STYLE_FIXTURE, TEMPLATE_FIXTURE, glove80 } from "../../helpers/zmk.ts";

const gated = process.env.KEYLOOM_DOCKER_TESTS === "1" ? describe : describe.skip;

gated("a generated keymap built in Docker", () => {
  const TIMEOUT = 40 * 60_000;

  async function build(layout: Layout) {
    const board = await glove80();
    const dir = tempDir();
    const log = new LogSink(join(dir, "build.log"));
    const artifactPath = join(dir, "out.uf2");
    const source = generateZmkSource({ layout, board: board.definition, geometry: board.geometry, revisionId: "rev_test" });
    const r = await buildZmk({
      board: board.definition, source, checkoutDir: checkoutDirFor(board), imageContextDir: join(cacheDir(), "images", "moergo-glove80"), artifactPath, log,
      containerName: `keyloom-test-${process.pid}`,
    });
    log.close();
    return { ...r, bytes: await Bun.file(artifactPath).bytes() };
  }

  test("the template's default keymap, round-tripped through keyloom, builds to one combined UF2 with an image per half", async () => {
    const board = await glove80();
    const first = await importZmkSource(TEMPLATE_FIXTURE, board.definition);
    const source = generateZmkSource({ layout: first.layout, board: board.definition, geometry: board.geometry, revisionId: "rev_test" });
    const again = await importZmk({ name: "x", keymap: source.files[0]?.content as string, conf: source.files[1]?.content as string }, board.definition);
    expect(isDeepStrictEqual(again.layout, first.layout)).toBe(true);

    const built = await build(first.layout);
    expect(uf2Problem(built.bytes)).toBeUndefined();
    const info = inspectUf2(built.bytes);
    expect("problem" in info).toBe(false);
    if (!("problem" in info)) expect(info.images.map((i) => i.family)).toEqual([0x9807b007, 0x9808b007]);
    expect(built.bytes.length).toBe(819_200);
  }, TIMEOUT);

  test("a layout with a hold-tap profile, a macro and a combo, edited and written by keyloom, compiles", async () => {
    const { layout } = await importZmkSource(STYLE_FIXTURE, (await glove80()).definition);
    const built = await build(layout);
    expect(uf2Problem(built.bytes)).toBeUndefined();
  }, TIMEOUT);

  test("a keymap with a key the compiler rejects fails with the layer and position", async () => {
    const { layout } = await importZmkSource(TEMPLATE_FIXTURE, (await glove80()).definition);
    const broken: Layout = {
      ...layout,
      layers: layout.layers.map((l, i) => (i === 0 ? { ...l, bindings: l.bindings.map((b, p) => (p === 7 ? { kind: "native" as const, firmware: "zmk" as const, source: "&kp NOT_A_KEY_AT_ALL", label: "?" } : b)) } : l)),
    };
    await expect(build(broken)).rejects.toThrow(/parse error.*layer "default_layer" \(layer 0\), one of positions 0 to 9/);
  }, TIMEOUT);
});
