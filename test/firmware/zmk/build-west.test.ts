// Builds an upstream-ZMK board (zmk-west-docker) against a fake `docker`: everything keyloom does around
// west (the config files, the manifest, the container command, the bundle) without a real compile. The real
// build is what the contributor's own run proves; see CONTRIBUTING.md.
import { describe, expect, test } from "bun:test";
import { unzipSync } from "fflate";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadBoardDir } from "../../../src/boards/load.ts";
import { BuildFailure } from "../../../src/firmware/zmk/build.ts";
import { buildZmkWest, westManifest, westScript } from "../../../src/firmware/zmk/build-west.ts";
import { LogSink } from "../../../src/firmware/toolchain/run.ts";
import { uf2Problem } from "../../../src/firmware/toolchain/uf2.ts";
import { templateCopy } from "../../helpers/board-recipes.ts";
import { fakeBinDir, fakeSha256Probe, withPath } from "../../helpers/fake-bin.ts";
import { tempDir } from "../../helpers/tmp.ts";
import { uf2Image } from "../../helpers/zmk.ts";

const FAKE_DOCKER_WEST = `
case "$1" in
  rm) echo "$@" >> "$FAKE_DOCKER_LOG"; [ -n "$FAKE_RM_FAIL" ] && exit 1; [ -n "$FAKE_RM_HANG" ] && { sleep 5 >/dev/null 2>&1 & trap 'kill $!; exit 0' TERM; wait; exit 0; }; exit 0;;
  ps) echo "$@" >> "$FAKE_DOCKER_LOG"; [ -n "$FAKE_PS_FAIL" ] && { echo "error during connect" >&2; exit 1; }; [ -n "$FAKE_PS_HANG" ] && { sleep 5 >/dev/null 2>&1 & trap 'kill $!; exit 0' TERM; wait; exit 0; }; [ -n "$FAKE_ORPHANS" ] && echo "$FAKE_ORPHANS"; exit 0;;
esac
echo "$@" >> "$FAKE_DOCKER_LOG"
vol=""; prev=""
for a in "$@"; do [ "$prev" = "-v" ] && vol="\${a%%:/work}"; prev="$a"; done
${fakeSha256Probe("/work")}
case " $* " in *" test -f config/west.yml "*) [ -f "$vol/config/west.yml" ] && exit 0 || exit 86;; esac
case "$FAKE_MODE" in
  ok) for t in left right; do mkdir -p "$vol/build/$t/zephyr"; cp "$FAKE_UF2" "$vol/build/$t/zephyr/zmk.uf2"; done; echo "Wrote zmk.uf2"; exit 0;;
  noright) mkdir -p "$vol/build/left/zephyr"; cp "$FAKE_UF2" "$vol/build/left/zephyr/zmk.uf2"; exit 0;;
  badbin) for t in left right; do mkdir -p "$vol/build/$t/zephyr"; echo "not a uf2" > "$vol/build/$t/zephyr/zmk.uf2"; done; exit 0;;
  compile) echo "/work/config/board.keymap:$FAKE_LINE:$FAKE_COL: error: 'NOPE' undeclared"; exit 1;;
  log) cat "$FAKE_LOG"; exit 2;;
  disk) echo "No space left on device"; exit 1;;
esac
exit 9
`;

async function setup() {
  const board = await loadBoardDir(await templateCopy("zmk"));
  const dir = tempDir();
  const uf2 = join(dir, "one.uf2");
  await Bun.write(uf2, uf2Image(0xada52840, 4));
  const log = new LogSink(join(dir, "build.log"));
  const lines: string[] = [];
  const dockerLog = join(dir, "docker.calls");
  const source = {
    keymapName: "board",
    files: [{ path: "board.keymap", content: "// keymap\n" }, { path: "board.conf", content: "# conf\n" }],
  };
  const bin = fakeBinDir({ docker: FAKE_DOCKER_WEST });
  const build = (mode: string, extra: Record<string, string> = {}) =>
    withPath(
      bin,
      () =>
        buildZmkWest({
          board: board.definition, source, checkoutDir: join(dir, "work"), imageContextDir: join(dir, "image"), artifactPath: join(dir, "out", "bld.zip"),
          log, containerName: "keyloom-test", onLine: (l) => lines.push(l), containerCheckTimeoutMs: 300,
        }),
      { FAKE_MODE: mode, FAKE_DOCKER_LOG: dockerLog, FAKE_UF2: uf2, ...extra },
    );
  return { build, dir, lines, dockerLog, board };
}

/** The failure a build ended in; a build that passed fails the test. */
const failureOf = (p: Promise<unknown>): Promise<BuildFailure> => p.then(() => { throw new Error("the build passed"); }, (e: unknown) => e as BuildFailure);

describe("buildZmkWest (fake docker)", () => {
  test("an external board module is pinned, each half selects its own board, and no shield is invented", async () => {
    const s = await setup();
    const build = s.board.definition.revisions[0]!.build;
    if (build.kind !== "zmk-west-docker") throw new Error("expected west recipe");
    build.boardModule = { repo: "https://github.com/Keebart/zmk-config", sha: "a".repeat(40) };
    build.targets = [{ id: "left", board: "corne_choc_pro_left" }, { id: "right", board: "corne_choc_pro_right" }];
    await s.build("ok");
    const manifest = await Bun.file(join(s.dir, "work", "config", "west.yml")).text();
    expect(manifest).toContain("name: board-module");
    expect(manifest).toContain("revision: " + "a".repeat(40));
    const script = westScript(build, true);
    expect(script).toContain("-b corne_choc_pro_left -- -DZMK_CONFIG");
    expect(script).toContain("-b corne_choc_pro_right -- -DZMK_CONFIG");
    expect(script).not.toContain("-DSHIELD=undefined");
    expect(script).toContain("CMAKE_BUILD_PARALLEL_LEVEL=5");
    // A cancelled update's git locks are cleared before the next update, which would otherwise fail on them.
    expect(script.indexOf("-name '*.lock' -print -delete")).toBeGreaterThan(-1);
    expect(script.indexOf("-name '*.lock' -print -delete")).toBeLessThan(script.indexOf("west update"));
  });

  test("a half with its own product name gets a conf fragment and a build flag", async () => {
    const s = await setup();
    const build = s.board.definition.revisions[0]!.build;
    if (build.kind !== "zmk-west-docker") throw new Error("expected west recipe");
    build.targets = build.targets.map((t) => ({ ...t, productName: t.id === "left" ? "Board Left" : "Board Right" }));
    await s.build("ok");
    expect(await Bun.file(join(s.dir, "work", "config", "keyloom-left.conf")).text()).toBe('# Written by keyloom: this half\'s USB product name.\nCONFIG_USB_DEVICE_PRODUCT="Board Left"\n');
    const script = westScript(build);
    expect(script).toContain("-DEXTRA_CONF_FILE=/work/config/keyloom-left.conf");
    expect(script).toContain("-DEXTRA_CONF_FILE=/work/config/keyloom-right.conf");
    // A target without a name keeps the plain command, so no board gets a fragment it did not ask for.
    const unnamed = s.board.definition.revisions[0]!.build as typeof build;
    expect(westScript({ ...unnamed, targets: unnamed.targets.map((t) => ({ id: t.id, ...(t.shield ? { shield: t.shield } : {}) })) })).not.toContain("EXTRA_CONF_FILE");
  });

  test("writes the manifest pinned to the board's ZMK SHA and the keymap and conf into config/, then bundles one UF2 per target", async () => {
    const s = await setup();
    const r = await s.build("ok");
    const rev = s.board.definition.revisions[0] as { source: { repo: string; sha: string } };
    expect(await Bun.file(join(s.dir, "work", "config", "west.yml")).text()).toBe(westManifest(rev.source.repo, rev.source.sha));
    expect(await Bun.file(join(s.dir, "work", "config", "board.keymap")).text()).toBe("// keymap\n");
    expect(await Bun.file(join(s.dir, "work", "config", "board.conf")).text()).toBe("# conf\n");

    const bundle = unzipSync(new Uint8Array(await Bun.file(join(s.dir, "out", "bld.zip")).arrayBuffer()));
    expect(Object.keys(bundle).sort()).toEqual(["left.uf2", "right.uf2"]);
    for (const bytes of Object.values(bundle)) expect(uf2Problem(bytes, "single")).toBeUndefined();
    expect(r.bytes).toBeGreaterThan(0);
    expect(s.lines.some((l) => l.includes("board_left: ") && l.includes("1 image"))).toBe(true);
  });

  test("the container runs as the caller, with the work folder mounted, from the digest-pinned image, one west build per target", async () => {
    const s = await setup();
    await s.build("ok");
    // The script is an argument with newlines in it, so the log holds it as several lines; everything from the run on is the run.
    const text = await Bun.file(s.dockerLog).text();
    const run = text.slice(text.indexOf("run --rm --name keyloom-test"));
    expect(run).toContain(`--user ${process.getuid?.()}:${process.getgid?.()}`);
    expect(run).toContain(`-v ${join(s.dir, "work")}:/work`);
    expect(run).toContain("zmkfirmware/zmk-build-arm@sha256:");
    expect(run).toContain("west build -p always -s zmk/app -d build/left -b nice_nano_v2 -- -DSHIELD=board_left -DZMK_CONFIG=/work/config");
    expect(run).toContain("-DSHIELD=board_right");
    expect(run.indexOf("west update")).toBeLessThan(run.indexOf("west build"));
  });

  test("a container an earlier keyloom left in this checkout is removed before the build, and the build's own is labelled", async () => {
    const s = await setup();
    await s.build("ok", { FAKE_ORPHANS: "0123abcd" });
    const calls = (await Bun.file(s.dockerLog).text()).split("\n");
    const label = `dev.keyloom.checkout=${join(s.dir, "work")}`;
    expect(calls.some((l) => l === `ps -aq --filter label=${label}`)).toBe(true);
    const removed = calls.findIndex((l) => l === "rm -f 0123abcd");
    expect(removed).toBeGreaterThan(-1);
    expect(removed).toBeLessThan(calls.findIndex((l) => l.includes(" --name keyloom-test ")));
    expect(calls.find((l) => l.includes(" --name keyloom-test "))).toContain(`--label ${label}`);
    expect(s.lines.some((l) => l.includes("removing a build container an earlier keyloom left running in this checkout"))).toBe(true);
  });

  test("the build stops before west runs when keyloom can't check for, or remove, an earlier container", async () => {
    const unread = await setup();
    await expect(unread.build("ok", { FAKE_PS_FAIL: "1" })).rejects.toThrow("couldn't check for a build container an earlier keyloom left");
    expect(await Bun.file(unread.dockerLog).text()).not.toContain(" --name keyloom-test ");
    const stuck = await setup();
    await expect(stuck.build("ok", { FAKE_ORPHANS: "0123abcd", FAKE_RM_FAIL: "1" })).rejects.toThrow("couldn't remove the build container an earlier keyloom left");
    expect(await Bun.file(stuck.dockerLog).text()).not.toContain(" --name keyloom-test ");
    // A command stopped at its timeout that still exits 0 is not an answer either.
    const slowList = await setup();
    await expect(slowList.build("ok", { FAKE_PS_HANG: "1" })).rejects.toThrow("docker ps timed out");
    expect(await Bun.file(slowList.dockerLog).text()).not.toContain(" --name keyloom-test ");
    const slowRemove = await setup();
    await expect(slowRemove.build("ok", { FAKE_ORPHANS: "0123abcd", FAKE_RM_HANG: "1" })).rejects.toThrow("docker rm timed out");
    expect(await Bun.file(slowRemove.dockerLog).text()).not.toContain(" --name keyloom-test ");
  });

  test("hashes west.yml and the config files inside the container before west runs, and waits out a stale view", async () => {
    const s = await setup();
    await s.build("ok", { FAKE_STALE_CALLS: "2" });
    const calls = (await Bun.file(s.dockerLog).text()).split("\n");
    const hashes = calls.filter((l) => l.includes("--entrypoint sha256sum"));
    expect(hashes).toHaveLength(3);
    for (const f of ["west.yml", "board.keymap", "board.conf"]) expect(hashes[0]).toContain(`/work/config/${f}`);
    expect(calls.lastIndexOf(hashes[2] as string)).toBeLessThan(calls.findIndex((l) => l.includes(" --name keyloom-test ")));
  });

  test("the script clears old output inside the container and stops at the first failing target", async () => {
    const s = await setup();
    const script = westScript(s.board.definition.revisions[0]?.build as never);
    expect(script.split("\n")[0]).toBe("set -e");
    expect(script).toContain("rm -rf build");
  });

  test("a keymap or conf left from an earlier layout is removed before the new ones are written", async () => {
    const s = await setup();
    await Bun.write(join(s.dir, "work", "config", "old.keymap"), "stale");
    await Bun.write(join(s.dir, "work", "config", "old.conf"), "stale");
    await s.build("ok");
    expect(existsSync(join(s.dir, "work", "config", "old.keymap"))).toBe(false);
    expect(existsSync(join(s.dir, "work", "config", "old.conf"))).toBe(false);
  });

  test("a target that produced no UF2 fails the build and names the shield", async () => {
    const s = await setup();
    await expect(s.build("noright")).rejects.toThrow(/board_right produced no zmk\.uf2/);
  });

  test("a UF2 that isn't one fails the build before anything is kept", async () => {
    const s = await setup();
    await expect(s.build("badbin")).rejects.toThrow(/can't be flashed/);
    expect(existsSync(join(s.dir, "out", "bld.zip"))).toBe(false);
  });

  test("a compile error in the keymap is located by the generated file's own name", async () => {
    const s = await setup();
    await expect(s.build("compile", { FAKE_LINE: "1", FAKE_COL: "3" })).rejects.toThrow(/doesn't compile: .*line 1 of board\.keymap/);
    expect((await failureOf(s.build("compile", { FAKE_LINE: "1", FAKE_COL: "3" }))).code).toBe("compile_error");
  });

  test("a firmware too big for the flash carries its code and how much (R5-02)", async () => {
    const s = await setup();
    const err = await failureOf(s.build("log", { FAKE_LOG: join(import.meta.dir, "../../fixtures/build-logs/ld-region-overflow.log") }));
    expect(err.code).toBe("too_large");
    expect(err.message).toContain("memory by 228 bytes");
  });

  test("a full Docker disk says so", async () => {
    const s = await setup();
    await expect(s.build("disk")).rejects.toThrow(BuildFailure);
    await expect(s.build("disk")).rejects.toThrow(/ran out of disk space/);
  });

  test("a work folder Docker can't see is reported with how to fix it", async () => {
    const s = await setup();
    // The fake probe fails when config/west.yml isn't visible; it is written before the probe, so hide it by mode.
    // An engine that can't see the folder still answers `ps`.
    const probe = (exit: number) => withPath(fakeBinDir({ docker: `case "$1" in rm|ps) exit 0;; esac\nexit ${exit}` }), () =>
      buildZmkWest({
        board: s.board.definition, source: { keymapName: "board", files: [] }, checkoutDir: join(s.dir, "w2"), imageContextDir: join(s.dir, "i"),
        artifactPath: join(s.dir, "o.zip"), log: new LogSink(join(s.dir, "l.log")), containerName: "x",
      }));
    await expect(probe(86)).rejects.toMatchObject({ message: expect.stringContaining("Docker can't see"), code: "folder_not_shared" });
    // Docker's own failure (125: it couldn't create the container) isn't a folder it can't see, and may pass (PR #303 CodeRabbit).
    const other = await probe(125).catch((x: unknown) => x);
    expect(other).toBeInstanceOf(BuildFailure);
    expect((other as BuildFailure).code).toBeNull();
    expect((other as BuildFailure).message).toMatch(/exit 125/);
    expect((other as BuildFailure).message).not.toMatch(/can't see/);
    // Docker Desktop refuses a folder outside File sharing before the container starts: exit 125 with its own words (PR #303 review).
    const denied = await withPath(fakeBinDir({ docker: `case "$1" in rm|ps) exit 0;; esac\necho "docker: Error response from daemon: Mounts denied: " >&2\necho "The path $PWD is not shared from the host and is not known to Docker." >&2\nexit 125` }), () =>
      buildZmkWest({
        board: s.board.definition, source: { keymapName: "board", files: [] }, checkoutDir: join(s.dir, "w3"), imageContextDir: join(s.dir, "i"),
        artifactPath: join(s.dir, "o.zip"), log: new LogSink(join(s.dir, "l3.log")), containerName: "x",
      })).catch((x: unknown) => x);
    expect(denied).toMatchObject({ code: "folder_not_shared", message: expect.stringContaining("Resources > File sharing") });
  });
});
