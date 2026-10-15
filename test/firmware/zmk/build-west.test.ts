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
import { fakeBinDir, withPath } from "../../helpers/fake-bin.ts";
import { tempDir } from "../../helpers/tmp.ts";
import { uf2Image } from "../../helpers/zmk.ts";

const FAKE_DOCKER_WEST = `
case "$1" in
  rm) echo "$@" >> "$FAKE_DOCKER_LOG"; exit 0;;
esac
echo "$@" >> "$FAKE_DOCKER_LOG"
vol=""; prev=""
for a in "$@"; do [ "$prev" = "-v" ] && vol="\${a%%:/work}"; prev="$a"; done
case " $* " in *" test -f config/west.yml "*) [ -f "$vol/config/west.yml" ] && exit 0 || exit 1;; esac
case "$FAKE_MODE" in
  ok) for t in left right; do mkdir -p "$vol/build/$t/zephyr"; cp "$FAKE_UF2" "$vol/build/$t/zephyr/zmk.uf2"; done; echo "Wrote zmk.uf2"; exit 0;;
  noright) mkdir -p "$vol/build/left/zephyr"; cp "$FAKE_UF2" "$vol/build/left/zephyr/zmk.uf2"; exit 0;;
  badbin) for t in left right; do mkdir -p "$vol/build/$t/zephyr"; echo "not a uf2" > "$vol/build/$t/zephyr/zmk.uf2"; done; exit 0;;
  compile) echo "/work/config/board.keymap:$FAKE_LINE:$FAKE_COL: error: 'NOPE' undeclared"; exit 1;;
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
          log, containerName: "keyloom-test", onLine: (l) => lines.push(l),
        }),
      { FAKE_MODE: mode, FAKE_DOCKER_LOG: dockerLog, FAKE_UF2: uf2, ...extra },
    );
  return { build, dir, lines, dockerLog, board };
}

describe("buildZmkWest (fake docker)", () => {
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
  });

  test("a full Docker disk says so", async () => {
    const s = await setup();
    await expect(s.build("disk")).rejects.toThrow(BuildFailure);
    await expect(s.build("disk")).rejects.toThrow(/ran out of disk space/);
  });

  test("a work folder Docker can't see is reported with how to fix it", async () => {
    const s = await setup();
    // The fake probe fails when config/west.yml isn't visible; it is written before the probe, so hide it by mode.
    const bin = fakeBinDir({ docker: `case "$1" in rm) exit 0;; esac\nexit 1` });
    await expect(
      withPath(bin, () =>
        buildZmkWest({
          board: s.board.definition, source: { keymapName: "board", files: [] }, checkoutDir: join(s.dir, "w2"), imageContextDir: join(s.dir, "i"),
          artifactPath: join(s.dir, "o.zip"), log: new LogSink(join(s.dir, "l.log")), containerName: "x",
        }),
      ),
    ).rejects.toThrow(/Docker can't see/);
  });
});
