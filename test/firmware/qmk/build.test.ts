// Builds against a fake `docker` and a local git repo standing in for ZSA's fork: everything keyloom
// does around QMK (checkout, keymap folder, artifact, failure messages) without a 100 s compile.
// The real Docker build is the gated test in docker.test.ts.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BoardDefinition } from "../../../src/boards/schema.ts";
import { BuildFailure, buildQmk } from "../../../src/firmware/qmk/build.ts";
import { generateQmkSource } from "../../../src/firmware/qmk/generate.ts";
import { describeLocated, locateCompileError } from "../../../src/firmware/qmk/locate-error.ts";
import { importOryxSource } from "../../../src/firmware/qmk/import.ts";
import { LogSink } from "../../../src/firmware/toolchain/run.ts";
import { FAKE_DOCKER, dfuImage, fakeBinDir, withPath } from "../../helpers/fake-bin.ts";
import { gitEnv, originRepo } from "../../helpers/git-fixture.ts";
import { FIXTURE_DIR, moonlander } from "../../helpers/board.ts";
import { tempDir } from "../../helpers/tmp.ts";

const real = await moonlander();
const { layout } = await importOryxSource(FIXTURE_DIR, real.definition);

async function setup(over: { makefile?: boolean } = {}) {
  const origin = originRepo({ makefile: over.makefile ?? true });
  const rev = (r: BoardDefinition["revisions"][number]) => ({ ...r, source: { ...r.source, repo: origin.url, sha: origin.sha }, build: { ...r.build, submodules: [] } });
  const board: BoardDefinition = { ...real.definition, revisions: real.definition.revisions.map(rev) };
  const bin = fakeBinDir({ docker: FAKE_DOCKER });
  const dir = tempDir();
  const dockerLog = join(dir, "docker.calls");
  const binFile = join(dir, "fake.bin");
  await Bun.write(binFile, dfuImage("3297:2003", 200));
  const lines: string[] = [];
  const log = new LogSink(join(dir, "build.log"));
  const source = generateQmkSource({ layout, board, revisionId: "rev_T", boardRevisionId: "revb" });
  const build = (mode: string, extra: Record<string, string> = {}, input: Partial<Parameters<typeof buildQmk>[0]> = {}) =>
    withPath(bin, () =>
      buildQmk({
        board, boardRevisionId: "revb", source, checkoutDir: join(dir, "checkout"), artifactPath: join(dir, "out", "bld.bin"), log,
        containerName: "keyloom-test", onLine: (l) => lines.push(l), ...input,
      }),
    { FAKE_MODE: mode, FAKE_DOCKER_LOG: dockerLog, FAKE_BIN_REVA: binFile, FAKE_BIN_REVB: binFile, ...gitEnv, ...extra });
  return { build, dir, lines, dockerLog, source, board, log };
}

describe("buildQmk (fake docker)", () => {
  test("creates the pinned checkout, writes the keymap folder, runs the documented docker command and copies the artifact", async () => {
    const s = await setup();
    const r = await s.build("ok");
    expect(r.bytes).toBe(216);
    expect(existsSync(join(s.dir, "out", "bld.bin"))).toBe(true);
    const keymapDir = join(s.dir, "checkout", "keyboards/zsa/moonlander/keymaps/keyloom");
    for (const f of ["keymap.c", "config.h", "rules.mk", "keymap.json"]) expect(existsSync(join(keymapDir, f))).toBe(true);
    const calls = await Bun.file(s.dockerLog).text();
    const make = calls.split("\n").find((l) => l.includes(" make "));
    expect(make).toContain("--rm");
    expect(make).toContain(`--user ${process.getuid?.()}:${process.getgid?.()}`);
    expect(make).toContain("-w /qmk_firmware");
    expect(make).toContain(`-v ${join(s.dir, "checkout")}:/qmk_firmware`);
    expect(make).toContain("-e SKIP_GIT=1 -e MAKEFLAGS=-j4");
    expect(make).toContain("ghcr.io/qmk/qmk_cli@sha256:b7d7fa8fb4432b569931de5ad59098cb788f440ed61a62c5126746b71aee0f4a make zsa/moonlander/revb:keyloom");
    expect(make).not.toContain(" -it");
    expect(make).not.toContain(" -t ");
    expect(s.lines.some((l) => l.includes("DFU 3297:2003"))).toBe(true);
  });

  test("a stale .bin from an earlier build can't pass for this one", async () => {
    const s = await setup();
    await s.build("ok");
    await expect(s.build("nobin")).rejects.toThrow(/zsa_moonlander_revb_keyloom\.bin was not produced/);
  });

  test("a file built for the other revision's bootloader is a failed build, not an artifact", async () => {
    const s = await setup();
    await Bun.write(join(s.dir, "fake.bin"), dfuImage("0483:df11", 200));
    await expect(s.build("ok")).rejects.toThrow(/built for the 0483:df11 bootloader/);
    expect(existsSync(join(s.dir, "out", "bld.bin"))).toBe(false);
  });

  test("a compile error in a key is reported as its layer and position", async () => {
    const s = await setup();
    const keymapC = s.source.files.find((f) => f.path === "keymap.c")?.content as string;
    const lines = keymapC.split("\n");
    const line = lines.findIndex((l) => l.includes("MT(MOD_LALT, KC_S)")) + 1;
    const column = (lines[line - 1] as string).indexOf("MT(MOD_LALT, KC_S)") + 1;
    const err = await s.build("compile", { FAKE_LINE: String(line), FAKE_COL: String(column + 4) }).catch((e) => e as Error);
    expect(err).toBeInstanceOf(BuildFailure);
    expect((err as Error).message).toBe("The generated firmware doesn't compile: layer-0, position 30: 'KC_NOPE' undeclared");
  });

  test("an error outside keymaps[] has no position, but still the compiler's words", async () => {
    const s = await setup();
    const err = await s.build("compile", { FAKE_LINE: "3", FAKE_COL: "1" }).catch((e) => e as Error);
    expect((err as Error).message).toBe("The generated firmware doesn't compile: 'KC_NOPE' undeclared");
  });

  test("a full Docker disk is called what it is", async () => {
    const s = await setup();
    await expect(s.build("disk")).rejects.toThrow(/Docker ran out of disk space/);
  });

  test("Docker not able to see the checkout is called what it is, before make's confusing 'no rule'", async () => {
    const s = await setup({ makefile: false });
    await expect(s.build("ok")).rejects.toThrow(/Docker can't see .*File sharing/);
  });

  test("a build past its timeout is stopped, the container removed, and the message says so", async () => {
    const s = await setup();
    const started = Date.now();
    await expect(s.build("hang", {}, { timeoutMs: 400 })).rejects.toThrow(/took longer than/);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await Bun.file(s.dockerLog).text()).toContain("rm -f keyloom-test");
  });

  test("cancelling stops the build and removes the container", async () => {
    const s = await setup();
    const c = new AbortController();
    setTimeout(() => c.abort(), 500);
    await expect(s.build("hang", {}, { signal: c.signal })).rejects.toThrow("The build was cancelled.");
    expect(await Bun.file(s.dockerLog).text()).toContain("rm -f keyloom-test");
  });

  test("a second build reuses the checkout without cloning again", async () => {
    const s = await setup();
    await s.build("ok");
    s.lines.length = 0;
    await s.build("ok");
    expect(s.lines.some((l) => l.includes("creating"))).toBe(false);
  });
});

describe("locateCompileError", () => {
  test("ignores log lines that are not compiler errors", () => {
    expect(locateCompileError(["Compiling: x [OK]", "warning: nope"], "", real.definition)).toBeUndefined();
  });

  test("a hold-tap's own comma doesn't move the position", () => {
    const keymapC = generateQmkSource({ layout, board: real.definition, revisionId: "rev_T" }).files[0]?.content as string;
    const lines = keymapC.split("\n");
    const line = lines.findIndex((l) => l.includes("MT(MOD_LGUI, KC_F)")) + 1;
    const col = (lines[line - 1] as string).indexOf("KC_F)") + 1;
    const found = locateCompileError([`keyboards/zsa/moonlander/keymaps/keyloom/keymap.c:${line}:${col}: error: bad`], keymapC, real.definition);
    expect(found && describeLocated(found)).toBe("layer-0, position 32: bad");
  });
});
