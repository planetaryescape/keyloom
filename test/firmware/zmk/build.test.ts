// Builds against a fake `docker` and a local git repo standing in for MoErgo's template: everything keyloom
// does around the Nix build (checkout, image, config files, artifact, failure messages) without a real
// compile. The real Docker build is the gated test in docker.test.ts.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BuildFailure, buildZmk } from "../../../src/firmware/zmk/build.ts";
import { generateZmkSource } from "../../../src/firmware/zmk/generate.ts";
import { importZmkSource } from "../../../src/firmware/zmk/import.ts";
import { imageTag } from "../../../src/firmware/zmk/image.ts";
import { describeLocation, locateCompileError, locateConfError } from "../../../src/firmware/zmk/locate-error.ts";
import { LogSink } from "../../../src/firmware/toolchain/run.ts";
import { fakeBinDir, withPath } from "../../helpers/fake-bin.ts";
import { gitEnv } from "../../helpers/git-fixture.ts";
import { tempDir } from "../../helpers/tmp.ts";
import { FAKE_DOCKER_ZMK, TEMPLATE_FIXTURE, boardWithTemplate, combinedUf2, glove80, templateRepo } from "../../helpers/zmk.ts";

const real = await glove80();
const { layout } = await importZmkSource(TEMPLATE_FIXTURE, real.definition);
const ZMK_SHA = real.definition.revisions[0]?.source.sha as string;

async function setup() {
  const origin = templateRepo();
  const board = boardWithTemplate(real.definition, origin);
  const bin = fakeBinDir({ docker: FAKE_DOCKER_ZMK });
  const dir = tempDir();
  const uf2 = join(dir, "fake.uf2");
  await Bun.write(uf2, combinedUf2());
  const lines: string[] = [];
  const log = new LogSink(join(dir, "build.log"));
  const source = generateZmkSource({ layout, board, geometry: real.geometry, revisionId: "rev_T" });
  const dockerLog = join(dir, "docker.calls");
  const build = (mode: string, extra: Record<string, string> = {}, input: Partial<Parameters<typeof buildZmk>[0]> = {}) =>
    withPath(bin, () =>
      buildZmk({
        board, source, checkoutDir: join(dir, "checkout"), imageContextDir: join(dir, "image"), artifactPath: join(dir, "out", "bld.uf2"), log,
        containerName: "keyloom-test", onLine: (l) => lines.push(l), ...input,
      }),
    { FAKE_MODE: mode, FAKE_DOCKER_LOG: dockerLog, FAKE_UF2: uf2, FAKE_IMAGE_MARK: join(dir, "image.mark"), ...gitEnv, ...extra });
  return { build, dir, lines, dockerLog, source };
}

describe("buildZmk (fake docker)", () => {
  test("clones the template at its pin, writes the config files, runs the template's container and copies the artifact", async () => {
    const s = await setup();
    const r = await s.build("ok");
    expect(r.bytes).toBe(10 * 512);
    expect(Buffer.from(await Bun.file(join(s.dir, "out", "bld.uf2")).bytes())).toEqual(Buffer.from(combinedUf2()));
    for (const f of s.source.files) expect(await Bun.file(join(s.dir, "checkout", "config", f.path)).text()).toBe(f.content);

    const calls = (await Bun.file(s.dockerLog).text()).split("\n");
    const run = calls.find((l) => l.includes(" --name keyloom-test "));
    expect(run).toBe(`run --rm --name keyloom-test -v ${join(s.dir, "checkout")}:/config -e UID=${process.getuid?.()} -e GID=${process.getgid?.()} ${imageTag(ZMK_SHA)}`);
    expect(s.lines.some((l) => l.includes("2 images: family 0x9807b007"))).toBe(true);
  });

  test("builds the image from the embedded Dockerfile, with the firmware ref as a build argument, only when it isn't local", async () => {
    const s = await setup();
    await s.build("ok", { FAKE_IMAGE: "missing" });
    const calls = (await Bun.file(s.dockerLog).text()).split("\n");
    expect(calls.find((l) => l.startsWith("build "))).toBe(`build -t ${imageTag(ZMK_SHA)} --build-arg ZMK_REF=${ZMK_SHA} ${join(s.dir, "image")}`);
    const dockerfile = await Bun.file(join(s.dir, "image", "Dockerfile")).text();
    expect(dockerfile).toContain("FROM nixpkgs/nix:nixos-23.11@sha256:");
    expect(dockerfile).toContain(`ARG ZMK_REF=${ZMK_SHA}`);

    const again = await setup();
    await again.build("ok");
    expect((await Bun.file(again.dockerLog).text()).includes("\nbuild ") || (await Bun.file(again.dockerLog).text()).startsWith("build ")).toBe(false);
  });

  test("hashes the config files, the module and default.nix inside the container before the build, and waits out a stale view", async () => {
    const s = await setup();
    await s.build("ok", { FAKE_STALE_CALLS: "2" });
    const calls = (await Bun.file(s.dockerLog).text()).split("\n");
    const hashes = calls.filter((l) => l.includes("--entrypoint sha256sum"));
    expect(hashes).toHaveLength(3);
    for (const f of ["config/default.nix", "config/glove80.keymap", "keyloom-zmk/CMakeLists.txt"]) expect(hashes[0]).toContain(`/config/${f}`);
    expect(calls.lastIndexOf(hashes[2] as string)).toBeLessThan(calls.findIndex((l) => l.includes(" --name keyloom-test ")));
  });

  test("the image tag names the firmware ref and the Dockerfile, so a change to either builds a new image", () => {
    expect(imageTag(ZMK_SHA)).toMatch(/^keyloom-glove80:ce69e85f585c-[0-9a-f]{10}$/);
    expect(imageTag("0".repeat(40))).not.toBe(imageTag(ZMK_SHA));
  });

  test("a stale glove80.uf2 can't pass for this build: it is removed in the container before the build", async () => {
    const s = await setup();
    await s.build("ok");
    await expect(s.build("nobin")).rejects.toThrow(/glove80\.uf2 was not produced/);
    const probe = (await Bun.file(s.dockerLog).text()).split("\n").filter((l) => l.includes("--entrypoint sh "));
    expect(probe).toHaveLength(2);
    expect(probe[0]).toContain("rm -f glove80.uf2");
  });

  test("a file that isn't a two-image UF2 is a failed build, not an artifact", async () => {
    const s = await setup();
    await expect(s.build("badbin")).rejects.toThrow(/can't be flashed: its size/);
    expect(existsSync(join(s.dir, "out", "bld.uf2"))).toBe(false);
  });

  test("a compile error in a key is reported as its layer and position", async () => {
    const s = await setup();
    const keymap = s.source.files[0]?.content as string;
    const lines = keymap.split("\n");
    const line = lines.findIndex((l) => l.includes("&layer_td")) + 1;
    const column = (lines[line - 1] as string).indexOf("&layer_td") + 1;
    const err = await s.build("compile", { FAKE_LINE: String(line), FAKE_COL: String(column + 2) }).catch((e) => e as Error);
    expect(err).toBeInstanceOf(BuildFailure);
    expect((err as Error).message).toBe('The generated keymap doesn\'t compile: \'NOPE\' undeclared at layer "default_layer" (layer 0), position 54 (&layer_td).');
  });

  test("an error outside the layers says which line of the keymap it is", async () => {
    const s = await setup();
    const err = await s.build("compile", { FAKE_LINE: "3", FAKE_COL: "1" }).catch((e) => e as Error);
    expect((err as Error).message).toMatch(/^The generated keymap doesn't compile: 'NOPE' undeclared at line 3 of glove80\.keymap \(#include <behaviors\.dtsi>\)\.$/);
  });

  test("a setting ZMK rejects is reported with its line of the conf, not the last line of Nix's output", async () => {
    const s = await setup();
    const out = ["warning: Deprecated symbol", "/nix/store/x-config/glove80.conf:2: warning: '\"x\"' is not a valid value for the bool symbol ZMK_USB_LOGGING (defined at /tmp/source/app/Kconfig:570). Assignment ignored.", "error: Aborting due to Kconfig warnings"];
    expect(locateConfError(out, "# header\nCONFIG_ZMK_USB_LOGGING=\"x\"\n")).toBe(
      "glove80.conf has a setting ZMK rejected: '\"x\"' is not a valid value for the bool symbol ZMK_USB_LOGGING (line 2: CONFIG_ZMK_USB_LOGGING=\"x\")",
    );
    expect(locateConfError(["fine"], "")).toBeUndefined();
    expect(s.dir).toBeTruthy();
  });

  test("a full Docker disk is called what it is", async () => {
    await expect((await setup()).build("disk")).rejects.toThrow(/Docker ran out of disk space/);
  });

  test("Docker not able to see the checkout is called what it is, before the build's confusing failure", async () => {
    const s = await setup();
    await s.build("ok");
    await Bun.$`rm ${join(s.dir, "checkout", "config", "default.nix")}`;
    await expect(s.build("ok")).rejects.toThrow(/Docker can't see .*home directory/);
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

describe("locating a compiler message", () => {
  test("cpp and dtc both print the file and line; messages that name another file are not ours", () => {
    expect(locateCompileError(["/nix/store/x-glove80.keymap:92:13: error: unterminated"])).toEqual({ line: 92, column: 13, message: "unterminated" });
    expect(locateCompileError(["Error: /nix/store/x-glove80.keymap:92.13-27: ERROR (duplicate_label): foo"])).toMatchObject({ line: 92, column: 13 });
    expect(locateCompileError(["devicetree error: /nix/store/x-config/glove80.keymap:89 (column 245): parse error: expected number"])).toEqual({ line: 89, column: undefined, message: "parse error: expected number" });
    expect(locateCompileError(["other.dtsi:3:1: error: no"])).toBeUndefined();
    expect(locateCompileError(["glove80.keymap:3:1: note: fine"])).toBeUndefined();
  });

  test("a binding in the middle of a row is found by its column, and a hold-tap's parameters don't shift the position", () => {
    const text = generateZmkSource({ layout, board: real.definition, geometry: real.geometry, revisionId: "rev_T" }).files[0]?.content as string;
    const lines = text.split("\n");
    const line = lines.findIndex((l) => l.includes("&magic MAGIC 0")) + 1;
    const col = (lines[line - 1] as string).indexOf("MAGIC 0") + 1;
    expect(describeLocation(text, { line, column: col, message: "" })).toBe('layer "default_layer" (layer 0), position 64 (&magic MAGIC 0)');
    // Zephyr's devicetree script gives a line and a column in text cpp has already expanded; only the row can be named.
    expect(describeLocation(text, { line, column: undefined, message: "" })).toBe('layer "default_layer" (layer 0), one of positions 64 to 79');
  });
});
