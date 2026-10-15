// emulateZmk against a fake `docker`: everything keyloom does around the container (the native keymap it
// sends, the command it runs, reading the log, the cache) without a real build. The real thing is
// test/firmware/zmk/emulate-docker.test.ts.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadBoardDir } from "../../../src/boards/load.ts";
import { EmulationError } from "../../../src/firmware/emulate/error.ts";
import { parseScript } from "../../../src/firmware/emulate/script.ts";
import type { EmulatorEvent } from "../../../src/firmware/emulate/types.ts";
import { MOERGO_INNER_SCRIPT, RUN_MARKER, emulateZmk, westEmulateScript } from "../../../src/firmware/zmk/emulate.ts";
import { generateZmkSource } from "../../../src/firmware/zmk/generate.ts";
import { importZmkSource } from "../../../src/firmware/zmk/import.ts";
import { LogSink } from "../../../src/firmware/toolchain/run.ts";
import { fakeBinDir, withPath } from "../../helpers/fake-bin.ts";
import { tempDir } from "../../helpers/tmp.ts";
import { STYLE_FIXTURE, glove80 } from "../../helpers/zmk.ts";

const FIXTURES = `${import.meta.dir}/../../fixtures/zmk`;

// `image inspect` and `rm` answer at once; a run records its arguments and standard input and replies by FAKE_MODE.
const FAKE_DOCKER_EMULATE = `
case "$1" in
  image|rm) exit 0;;
esac
printf '%s\n--\n' "$*" >> "$FAKE_DOCKER_LOG"
cat > "$FAKE_STDIN"
case "$FAKE_MODE" in
  ok) echo "[1/9] Building C object zephyr/kernel/CMakeFiles/kernel.dir/sched.c.obj"; echo ${RUN_MARKER}; cat "$FAKE_RUN"; exit 0;;
  compile) echo "devicetree error: /tmp/emu-config/native_posix_64.keymap:176 (column 9): parse error: expected number"; exit 1;;
  disk) echo "No space left on device"; exit 1;;
  crash) echo ${RUN_MARKER}; echo "ASSERTION FAIL"; exit 134;;
  norun) echo "built"; exit 0;;
esac
exit 9
`;

async function setup(boardDir: string, keymap: string, keymapName?: string) {
  const board = await loadBoardDir(boardDir);
  const { layout } = await importZmkSource(keymap, board.definition);
  const source = generateZmkSource({ layout, board: board.definition, geometry: board.geometry, revisionId: "rev_test", ...(keymapName ? { keymapName } : {}) });
  const dir = tempDir();
  const log = new LogSink(join(dir, "emulate.log"));
  const bin = fakeBinDir({ docker: FAKE_DOCKER_EMULATE });
  const env = (mode: string, run: string) => ({
    FAKE_MODE: mode, FAKE_DOCKER_LOG: join(dir, "docker.calls"), FAKE_STDIN: join(dir, "stdin"), FAKE_RUN: `${FIXTURES}/emulate/${run}.log`,
  });
  const go = (script: string | EmulatorEvent[], mode: string, run: string, extra: { timeoutMs?: number } = {}) =>
    withPath(
      bin,
      () =>
        emulateZmk({
          board: board.definition, boardRevision: "default", source, events: typeof script === "string" ? parseScript(script, { keyCount: board.definition.keyCount }) : script,
          checkoutDir: join(dir, "checkout"), workDir: join(dir, "work"), imageContextDir: join(dir, "image"), log, containerName: "keyloom-test", ...extra,
        }),
      env(mode, run),
    );
  const calls = async () => ((await Bun.file(join(dir, "docker.calls")).exists()) ? (await Bun.file(join(dir, "docker.calls")).text()).split("\n--\n").filter((c) => c !== "") : []);
  const stdin = async () => (await Bun.file(join(dir, "stdin")).text()).split("\n");
  return { board, source, dir, go, calls, stdin };
}

describe("emulateZmk for the Glove80 (MoErgo image)", () => {
  test("sends the native keymap on standard input, runs the Nix script in the pinned image and returns the reports", async () => {
    const e = await setup(`${import.meta.dir}/../../../boards/moergo/glove80`, STYLE_FIXTURE);
    const r = await e.go("tap 25", "ok", "glove80-tap-letter");
    expect(r.firmware).toBe("zmk");
    expect(r.reports).toEqual([
      { at: 0, kind: "keyboard", mods: [], keys: ["W"] },
      { at: 40, kind: "keyboard", mods: [], keys: [] },
    ]);
    expect(r.text).toBe("w");
    expect(r.warnings.some((w) => w.includes("&bt"))).toBe(true);

    const [call] = await e.calls();
    expect(call).toContain("run -i --rm --name keyloom-test -e KEYLOOM_EMULATE=");
    expect(call).toContain("--entrypoint sh keyloom-glove80:ce69e85f585c-");
    expect(call).toContain("nix-shell -A zmk default.nix --run");
    expect(call).not.toContain("-v ");
    const [keymap, conf] = (await e.stdin()).map((l) => Buffer.from(l, "base64").toString());
    expect(keymap).toContain("zmk,matrix-transform = &keyloom_emulate_transform;");
    expect(keymap).toContain("ZMK_MOCK_PRESS(0,24,39)");
    expect(keymap).not.toMatch(/&bt\b/);
    expect(conf).toBe("\n");
  });

  test("the same keys on the same keymap are answered from the saved log without starting the container again", async () => {
    const e = await setup(`${import.meta.dir}/../../../boards/moergo/glove80`, STYLE_FIXTURE);
    const first = await e.go("tap 25", "ok", "glove80-tap-letter");
    const second = await e.go("tap 25", "nobody-home", "glove80-tap-letter");
    expect(second).toEqual(first);
    expect(await e.calls()).toHaveLength(1);
    await e.go("tap 26", "ok", "glove80-tap-letter").catch(() => undefined);
    expect(await e.calls()).toHaveLength(2);
  });

  test("a keymap the compiler rejects is an EmulationError that carries what it said", async () => {
    const e = await setup(`${import.meta.dir}/../../../boards/moergo/glove80`, STYLE_FIXTURE);
    await expect(e.go("tap 25", "compile", "glove80-tap-letter")).rejects.toThrow(/the emulator couldn't build this keymap:.*parse error: expected number/);
  });

  test("a full Docker disk gets the build's own advice", async () => {
    const e = await setup(`${import.meta.dir}/../../../boards/moergo/glove80`, STYLE_FIXTURE);
    await expect(e.go("tap 25", "disk", "glove80-tap-letter")).rejects.toThrow(/Docker ran out of disk space/);
  });

  test("firmware that crashes while running says so, not that the build failed", async () => {
    const e = await setup(`${import.meta.dir}/../../../boards/moergo/glove80`, STYLE_FIXTURE);
    await expect(e.go("tap 25", "crash", "glove80-tap-letter")).rejects.toThrow(/the emulated firmware stopped with exit 134: .*ASSERTION FAIL/);
  });

  test("a container that never reached the run, or a run that saw fewer events than were sent, is an error", async () => {
    const e = await setup(`${import.meta.dir}/../../../boards/moergo/glove80`, STYLE_FIXTURE);
    await expect(e.go("tap 25", "norun", "glove80-tap-letter")).rejects.toThrow(/built the keymap but never ran it/);
    await expect(e.go("tap 25 then tap 26", "ok", "glove80-tap-letter")).rejects.toThrow(/saw 2 of the 4 key events/);
  });

  test("a key past the end of the board is refused before any container starts", async () => {
    const e = await setup(`${import.meta.dir}/../../../boards/moergo/glove80`, STYLE_FIXTURE);
    await expect(e.go([{ at: 0, position: 80, action: "press" }], "ok", "glove80-tap-letter")).rejects.toThrow(/key 81 doesn't exist; the board has keys 1 to 80/);
    await expect(e.go([{ at: 0, position: 80, action: "press" }], "ok", "glove80-tap-letter")).rejects.toThrow(EmulationError);
    expect(await e.calls()).toHaveLength(0);
  });
});

describe("emulateZmk for the Corne (ZMK's west image)", () => {
  test("mounts the board's west workspace, builds in the container and reads the consumer report", async () => {
    const e = await setup(`${import.meta.dir}/../../../boards/foostan/corne`, `${FIXTURES}/corne/corne.keymap`, "corne");
    const r = await e.go("tap 36", "ok", "corne-consumer");
    expect(r.reports).toEqual([
      { at: 0, kind: "consumer", usages: ["AUDIO_VOL_UP"] },
      { at: 40, kind: "consumer", usages: [] },
    ]);
    const [call] = await e.calls();
    expect(call).toContain(`-v ${join(e.dir, "checkout")}:/work`);
    expect(call).toContain("zmkfirmware/zmk-build-arm@sha256:");
    expect(call).toContain("west build -s zmk/app -d /tmp/emu-build -b native_posix_64");
    expect(await Bun.file(join(e.dir, "checkout", "config", "west.yml")).text()).toContain("revision: edf5c0814fd3ea202e43aad2d68fd32e882a518c");
    expect((await e.stdin())[0]).not.toBe("");
  });
});

describe("the container scripts", () => {
  test("both read the config from standard input and build in the container, not on the mount", () => {
    for (const script of [westEmulateScript("abc"), MOERGO_INNER_SCRIPT]) {
      expect(script).toContain("read -r KEYLOOM_KEYMAP; read -r KEYLOOM_CONF");
      expect(script).toContain("-DZMK_CONFIG=/tmp/emu-config");
      expect(script).toContain("/tmp/emu-build");
      expect(script.indexOf(RUN_MARKER)).toBeGreaterThan(script.indexOf("build"));
    }
  });

  test("the west script downloads firmware only when the workspace isn't at the pinned commit", () => {
    expect(westEmulateScript("abc123")).toContain('[ "$(git -C zmk rev-parse HEAD 2>/dev/null)" = abc123 ] || west update');
  });
});
