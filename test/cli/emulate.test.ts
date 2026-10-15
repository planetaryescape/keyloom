// `keyloom emulate` through the CLI, with the emulator replaced by a fake: what the command reads (the script,
// the layout, the board's key count), what it hands the emulator and how it prints the answer. The ZMK
// emulator itself is test/firmware/zmk/emulate.test.ts and, with real Docker, emulate-docker.test.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { EMULATORS } from "../../src/app/emulators.ts";
import { runCli } from "../../src/cli/main.ts";
import type { Io } from "../../src/cli/output.ts";
import type { Emulator, EmulatorInput } from "../../src/firmware/emulate/emulator.ts";
import type { EmulationResult } from "../../src/firmware/emulate/types.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { fakeBinDir, withPath } from "../helpers/fake-bin.ts";
import { tempDir } from "../helpers/tmp.ts";
import { STYLE_FIXTURE } from "../helpers/zmk.ts";

type Result = { code: number; out: string; err: string };
async function cli(args: string[]): Promise<Result> {
  let out = "";
  let err = "";
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: false };
  return { code: await runCli(args, io), out, err };
}
const json = (r: Result) => JSON.parse(r.out);
/** Errors go to stderr as JSON when it isn't a terminal. */
const problem = (r: Result): string => JSON.parse(r.err).error.message;

const original = { ...EMULATORS };
afterEach(() => Object.assign(EMULATORS, original));

const ANSWER: EmulationResult = {
  firmware: "zmk",
  reports: [
    { at: 281, kind: "keyboard", mods: ["LSFT"], keys: [] },
    { at: 300, kind: "keyboard", mods: ["LSFT"], keys: ["U"] },
    { at: 340, kind: "keyboard", mods: [], keys: [] },
    { at: 400, kind: "consumer", usages: ["AUDIO_VOL_UP"] },
  ],
  text: "U",
  warnings: ["1 binding uses &bt (Bluetooth), which can't run on a computer; it was replaced with &none."],
};

/** docker answers `version`; the fake emulator never starts it. */
const withDocker = <T>(fn: () => Promise<T>) => withPath(fakeBinDir({ docker: 'case "$1" in version) echo 28.0.0; exit 0;; esac\nexit 1' }), fn);

async function importedGlove80() {
  const dataDir = join(tempDir(), "data");
  await cli(["import", "--board", "moergo/glove80", STYLE_FIXTURE, "--data-dir", dataDir, "--name", "g80"]);
  return dataDir;
}

describe("keyloom emulate", () => {
  test("hands the emulator the parsed keys and the source a build would use, and prints the reports as a table", async () => {
    const dataDir = await importedGlove80();
    let seen: EmulatorInput | undefined;
    const fake: Emulator = async (input) => {
      seen = input;
      return ANSWER;
    };
    EMULATORS.zmk = fake;
    const r = await withDocker(() => cli(["emulate", "g80", "--keys", "hold 39 300 then tap 30", "--data-dir", dataDir, "--format", "table"]));
    expect(r.code).toBe(0);
    expect(r.out).toBe(
      [
        "   281 ms  LSFT",
        "   300 ms  LSFT + U",
        "   340 ms  (nothing down)",
        "   400 ms  media: AUDIO_VOL_UP",
        'text: "U"',
        "warnings:",
        "  1 binding uses &bt (Bluetooth), which can't run on a computer; it was replaced with &none.",
        "",
      ].join("\n"),
    );
    expect(seen?.board.id).toBe("moergo/glove80");
    expect(seen?.events.filter((e) => e.action === "press").map((e) => [e.at, e.position])).toEqual([[0, 38], [300, 29]]);
    expect(seen?.source.files.map((f) => f.path)).toEqual(["glove80.keymap", "glove80.conf"]);
    expect(seen?.source.files[0]?.content).toContain("&hm LGUI A");
  });

  test("--format json carries the reports, text, warnings and the log path", async () => {
    const dataDir = await importedGlove80();
    EMULATORS.zmk = async () => ANSWER;
    const r = await withDocker(() => cli(["emulate", "g80", "--keys", "tap 25", "--data-dir", dataDir, "--format", "json"]));
    const j = json(r);
    expect(j).toMatchObject({ schema_version: 1, firmware: "zmk", text: "U", reports: ANSWER.reports, warnings: ANSWER.warnings });
    expect(j.layout_id).toMatch(/^lay_/);
    expect(j.log_path).toContain(join(dataDir, "logs", "emulate-"));
  });

  test("--script reads the steps from a file, comments and all", async () => {
    const dataDir = await importedGlove80();
    const file = join(tempDir(), "keys.txt");
    await Bun.write(file, "# a tap\ntap 25\ntap 26\n");
    let events = 0;
    EMULATORS.zmk = async (input) => {
      events = input.events.length;
      return ANSWER;
    };
    expect((await withDocker(() => cli(["emulate", "g80", "--script", file, "--data-dir", dataDir]))).code).toBe(0);
    expect(events).toBe(4);
  });

  test("a mistake in the keys is a usage error that names the step, before any container starts", async () => {
    const dataDir = await importedGlove80();
    EMULATORS.zmk = async () => {
      throw new Error("must not run");
    };
    const bad = await cli(["emulate", "g80", "--keys", "tap 81", "--data-dir", dataDir]);
    expect(bad.code).toBe(2);
    expect(problem(bad)).toContain('there is no key 81 in "tap 81"; this board has keys 1 to 80');
    expect(problem(await cli(["emulate", "g80", "--keys", "poke 1", "--data-dir", dataDir]))).toContain("use tap, hold, release or wait");
  });

  test("keys and script are exclusive and one is required; an unreadable script file is named", async () => {
    const dataDir = await importedGlove80();
    expect(problem(await cli(["emulate", "g80", "--data-dir", dataDir]))).toContain("pass the key presses with --keys <script> or --script <file>, not both");
    expect((await cli(["emulate", "g80", "--keys", "tap 1", "--script", "x", "--data-dir", dataDir])).code).toBe(2);
    expect(problem(await cli(["emulate", "g80", "--script", "/nonexistent/keys.txt", "--data-dir", dataDir]))).toContain("can't read the script file /nonexistent/keys.txt");
  });

  test("a firmware without an emulator yet says so (exit 2)", async () => {
    const dataDir = join(tempDir(), "data");
    await cli(["import", "--board", "zsa/moonlander", FIXTURE_DIR, "--data-dir", dataDir, "--name", "bk"]);
    const r = await cli(["emulate", "bk", "--keys", "tap 1", "--data-dir", dataDir]);
    expect(r.code).toBe(2);
    expect(problem(r)).toContain("emulating QMK boards isn't available yet");
  });

  test("an emulator that fails is exit 7 with the reason and the log path", async () => {
    const dataDir = await importedGlove80();
    const { EmulationError } = await import("../../src/firmware/emulate/error.ts");
    EMULATORS.zmk = async () => {
      throw new EmulationError("the emulator couldn't build this keymap: nope");
    };
    const r = await withDocker(() => cli(["emulate", "g80", "--keys", "tap 1", "--data-dir", dataDir]));
    expect(r.code).toBe(7);
    expect(problem(r)).toContain("the emulator couldn't build this keymap: nope (log: ");
  });

  test("without Docker it fails with the same message a build gives", async () => {
    const dataDir = await importedGlove80();
    EMULATORS.zmk = async () => ANSWER;
    const none = fakeBinDir({ docker: "exit 1" });
    const r = await withPath(none, () => cli(["emulate", "g80", "--keys", "tap 1", "--data-dir", dataDir]));
    expect(r.code).toBe(7);
    expect(problem(r)).toContain("docker daemon isn't running");
  });

  test("--help shows the key script", async () => {
    const r = await cli(["emulate", "--help"]);
    expect(r.out).toContain("hold 31 300 then tap 32");
    expect(r.out).toContain("tap 31+32");
  });
});
