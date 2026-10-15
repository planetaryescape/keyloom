// import, generate, build and flash for the Glove80 through the CLI: the same commands as the Moonlander.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runCli } from "../../src/cli/main.ts";
import type { Io } from "../../src/cli/output.ts";
import { STYLE_FIXTURE, TEMPLATE_FIXTURE, fakeBootloaders, zmkEnv } from "../helpers/zmk.ts";
import { tempDir } from "../helpers/tmp.ts";

type Result = { code: number; out: string; err: string };
async function cli(args: string[]): Promise<Result> {
  let out = "";
  let err = "";
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: false };
  return { code: await runCli(args, io), out, err };
}
const json = (r: Result) => JSON.parse(r.out);

describe("keyloom import --board moergo/glove80", () => {
  test("reads a .keymap and reports what it kept as native and as written", async () => {
    const dataDir = join(tempDir(), "data");
    const r = await cli(["import", "--board", "moergo/glove80", join(TEMPLATE_FIXTURE, "glove80.keymap"), "--data-dir", dataDir, "--format", "json"]);
    expect(r.code).toBe(0);
    const j = json(r);
    expect(j.name).toBe("glove80");
    expect(j.report).toMatchObject({ layers: 4, keysPerLayer: 80, boardId: "moergo/glove80" });
    expect(j.report.native.length).toBeGreaterThan(20);
    expect(j.report.passthrough.map((p: { anchor: string }) => p.anchor)).toContain("behavior:layer_td");

    const table = await cli(["import", "--board", "moergo/glove80", STYLE_FIXTURE, "--data-dir", dataDir, "--name", "style", "--format", "table"]);
    expect(table.code).toBe(0);
    expect(table.out).toContain("profiles: hm, lt_sp, lt, mt");
  });

  test("a file that isn't a keymap is a usage error (exit 2) with the reason", async () => {
    const dir = tempDir();
    await Bun.write(join(dir, "x.txt"), "x");
    const r = await cli(["import", "--board", "moergo/glove80", join(dir, "x.txt"), "--data-dir", join(dir, "d")]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("not a .keymap file");
  });
});

describe("keyloom generate, build and flash for a Glove80 layout", () => {
  test("generate writes the two files", async () => {
    const e = await zmkEnv();
    const out = join(e.root, "gen");
    const r = await cli(["generate", "glove80", "--out", out, "--data-dir", e.dataDir, "--format", "json"]);
    expect(json(r)).toMatchObject({ files: ["glove80.keymap", "glove80.conf"], dir: out });
  });

  test("build prints the build and its .uf2; flash with --volumes-root writes both halves and prints the flash", async () => {
    const e = await zmkEnv();
    await e.run(async () => {
      const b = json(await cli(["build", "glove80", "--data-dir", e.dataDir, "--format", "json"]));
      expect(b).toMatchObject({ status: "succeeded", board_revision: "default" });
      expect(b.artifact_path).toBe(join(e.dataDir, "artifacts", `${b.build_id}.uf2`));

      const boot = fakeBootloaders(e.volumes, ["GLV80RHBOOT", "GLV80LHBOOT"], { mountAfterMs: [100, 800] });
      const r = await cli(["flash", "--layout", "glove80", "--volumes-root", e.volumes, "--data-dir", e.dataDir, "--format", "json"]);
      boot.stop();
      expect(r.code).toBe(0);
      expect(json(r)).toMatchObject({ status: "succeeded", build_id: b.build_id });
      expect(boot.written).toEqual(["GLV80RHBOOT", "GLV80LHBOOT"]);
      // The instruction for each half goes to stderr, so a script's stdout stays parseable.
      expect(r.err).toContain("Flash the right half (1 of 2)");
      expect(r.err).toContain("Flash the left half (2 of 2)");
    });
  });

  test("a flash cancelled while waiting for a bootloader is exit 8 and says nothing was flashed", async () => {
    const e = await zmkEnv();
    await e.run(async () => {
      await cli(["build", "glove80", "--data-dir", e.dataDir]);
      // The default wait is two minutes and nothing will appear in the volumes root, so Ctrl-C ends the wait.
      setTimeout(() => process.emit("SIGINT"), 300);
      const r = await cli(["flash", "--layout", "glove80", "--volumes-root", e.volumes, "--data-dir", e.dataDir]);
      expect(r.code).toBe(8);
      expect(r.err).toContain("Cancelled. Nothing was flashed.");
    });
  });
});

describe("keyloom doctor with a Glove80 board", () => {
  test("reports the firmware image and the template checkout", async () => {
    const e = await zmkEnv();
    await e.run(async () => {
      const r = json(await cli(["doctor", "--data-dir", e.dataDir]));
      const checks = r.checks as Array<{ name: string; ok: boolean; detail: string }>;
      // Contributed ZMK boards add their own image lines; the Glove80's must be among them.
      expect(checks.filter((c) => c.name === "firmware image").map((c) => c.detail)).toContainEqual(expect.stringMatching(/^keyloom-glove80:ce69e85f585c-[0-9a-f]{10} is built$/));
      const checkout = checks.find((c) => c.name === "checkout moergo/glove80");
      expect(checkout).toMatchObject({ ok: true });
      expect(checkout?.detail).toContain("pinned at 34888be8c");
    });
  });
});
