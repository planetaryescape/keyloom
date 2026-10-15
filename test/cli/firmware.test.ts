// generate, build, flash and doctor through the CLI, against fake docker, git and zapp.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runCli } from "../../src/cli/main.ts";
import type { Io } from "../../src/cli/output.ts";
import { toolchainEnv } from "../helpers/toolchain-env.ts";

type Result = { code: number; out: string; err: string };
async function cli(args: string[], opts: { tty?: boolean } = {}): Promise<Result> {
  let out = "";
  let err = "";
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: opts.tty ?? false };
  return { code: await runCli(args, io), out, err };
}
const json = (r: Result) => JSON.parse(r.out);

describe("keyloom generate", () => {
  test("writes the files and says where; --out is required", async () => {
    const e = await toolchainEnv();
    const out = join(e.root, "gen");
    const r = await cli(["generate", "synchronized", "--out", out, "--data-dir", e.dataDir, "--format", "json"]);
    expect(r.code).toBe(0);
    expect(json(r)).toMatchObject({ schema_version: 1, layout_id: e.imported.layoutId, revision_id: e.imported.revisionId, dir: out, files: ["keymap.c", "config.h", "rules.mk", "keymap.json"] });
    expect(await Bun.file(join(out, "keymap.c")).exists()).toBe(true);

    const missing = await cli(["generate", "synchronized", "--data-dir", e.dataDir]);
    expect(missing.code).toBe(2);
    const unknown = await cli(["generate", "nope", "--out", out, "--data-dir", e.dataDir]);
    expect(unknown.code).toBe(3);
  });
});

describe("keyloom build", () => {
  test("prints the build ID first, then the artifact; --format json carries the same", async () => {
    const e = await toolchainEnv();
    await e.run(async () => {
      const t = await cli(["build", "synchronized", "--board-rev", "revb", "--data-dir", e.dataDir], { tty: true });
      expect(t.code).toBe(0);
      const lines = t.out.split("\n");
      expect(lines[0]).toMatch(/^bld_[0-9A-Z]{26}$/);
      expect(lines[1]).toBe(`artifact: ${join(e.dataDir, "artifacts", `${lines[0]}.bin`)}`);
      // Progress goes to stderr, redrawn on one line; stdout stays clean.
      expect(t.err).toContain("\r");

      const j = json(await cli(["build", "synchronized", "--board-rev", "revb", "--data-dir", e.dataDir, "--format", "json"]));
      expect(j).toMatchObject({ schema_version: 1, status: "succeeded", board_revision: "revb", layout_id: e.imported.layoutId });
      expect(j.artifact_path).toBe(join(e.dataDir, "artifacts", `${j.build_id}.bin`));

      const quiet = await cli(["build", "synchronized", "--board-rev", "revb", "--data-dir", e.dataDir, "--quiet", "--format", "table"]);
      expect(quiet.out.trim()).toMatch(/^bld_[0-9A-Z]{26}$/);
    });
  });

  test("nothing but the answer on stderr when stdout is not a terminal", async () => {
    const e = await toolchainEnv();
    await e.run(async () => {
      const r = await cli(["build", "synchronized", "--board-rev", "revb", "--data-dir", e.dataDir]);
      expect(r.err).toBe("");
    });
  });

  test("a failed build exits 7 and says why", async () => {
    const e = await toolchainEnv();
    await e.run(async () => {
      const r = await cli(["build", "synchronized", "--board-rev", "revb", "--data-dir", e.dataDir, "--format", "table"]);
      expect(r.code).toBe(7);
      expect(r.err).toContain("error: build bld_");
      expect(r.err).toContain("Docker ran out of disk space");
      expect(r.err).toContain("(log: ");
      const j = await cli(["build", "synchronized", "--board-rev", "revb", "--data-dir", e.dataDir, "--format", "json"]);
      expect(JSON.parse(j.err).error.code).toBe("build_failed");
    }, { FAKE_MODE: "disk" });
  });

  test("without a connected keyboard, the board revision is asked for, as a usage error", async () => {
    const e = await toolchainEnv();
    await e.run(async () => {
      const r = await cli(["build", "synchronized", "--data-dir", e.dataDir]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("--board-rev reva|revb");
    });
  });
});

describe("keyloom flash", () => {
  test("flashes the newest build; the reset instruction goes to stderr whatever the format, the result to stdout", async () => {
    const e = await toolchainEnv();
    await e.run(async () => {
      const b = json(await cli(["build", "synchronized", "--board-rev", "revb", "--data-dir", e.dataDir]));
      const r = await cli(["flash", "--layout", "synchronized", "--data-dir", e.dataDir, "--format", "json"]);
      expect(r.code).toBe(0);
      expect(r.err).toContain("Press the reset button on the Moonlander");
      expect(json(r)).toMatchObject({ schema_version: 1, status: "succeeded", build_id: b.build_id, error: null });
      expect(await Bun.file(e.vars.ZAPP_CALLS).text()).toBe("ran\n");

      const byBuild = await cli(["flash", "--build", b.build_id, "--data-dir", e.dataDir, "--format", "ids"]);
      expect(byBuild.out.trim()).toMatch(/^fl_[0-9A-Z]{26}$/);
    });
  });

  test("zapp failing is exit 8", async () => {
    const e = await toolchainEnv({ zapp: 'echo "Firmware loaded: x"; echo "device disconnected" >&2; exit 2' });
    await e.run(async () => {
      await cli(["build", "synchronized", "--board-rev", "revb", "--data-dir", e.dataDir]);
      const r = await cli(["flash", "--layout", "synchronized", "--data-dir", e.dataDir, "--format", "table"]);
      expect(r.code).toBe(8);
      expect(r.err).toContain("device disconnected");
    });
  });

  test("--build and --layout together, or neither with several layouts, is a usage error; no build is one too", async () => {
    const e = await toolchainEnv();
    await e.run(async () => {
      expect((await cli(["flash", "--build", "bld_x", "--layout", "synchronized", "--data-dir", e.dataDir])).code).toBe(2);
      expect((await cli(["flash", "--layout", "synchronized", "--data-dir", e.dataDir])).code).toBe(2); // nothing built yet
      expect((await cli(["flash", "--build", "bld_nope", "--data-dir", e.dataDir])).code).toBe(3);
    });
    expect(await Bun.file(e.vars.ZAPP_CALLS).exists()).toBe(false);
  });
});

describe("keyloom doctor", () => {
  test("reports Docker, its disk, the image, zapp and the pinned checkout", async () => {
    const e = await toolchainEnv();
    await e.run(async () => {
      const r = json(await cli(["doctor", "--data-dir", e.dataDir]));
      const byName = new Map<string, { ok: boolean; detail: string; warn?: boolean }>(r.checks.map((c: { name: string }) => [c.name, c]));
      expect(byName.get("docker")).toMatchObject({ ok: true, detail: "running, server 28.0.0" });
      expect(byName.get("zapp")?.ok).toBe(true);
      expect(byName.get("zapp")?.detail).toContain("keyloom-bin-");
      expect(byName.get("checkout zsa/moonlander")).toMatchObject({ ok: true });
      expect(byName.get("checkout zsa/moonlander")?.detail).toContain("pinned at 93b2b9ec3");
      expect(byName.get("build image")?.detail).toContain("ghcr.io/qmk/qmk_cli");
    });
  });

  test("a missing zapp is a warning; Docker down and a checkout at another commit fail", async () => {
    const e = await toolchainEnv();
    // A PATH with no zapp (and no docker either, which this check doesn't look at).
    await e.run(async () => {
      const r = json(await cli(["doctor", "--data-dir", e.dataDir]));
      const zapp = r.checks.find((c: { name: string }) => c.name === "zapp");
      expect(zapp).toMatchObject({ ok: true, warn: true });
      expect(zapp.detail).toContain("brew install zapp");
    }, { PATH: "/usr/bin:/bin" });

    await e.run(async () => {
      const t = await cli(["doctor", "--data-dir", e.dataDir, "--format", "table"]);
      expect(t.code).toBe(1);
      expect(t.out).toContain("FAIL  docker: the docker daemon isn't running");
    }, { FAKE_MODE: "nodaemon" });

    await e.run(async () => {
      const t = await cli(["doctor", "--data-dir", e.dataDir, "--format", "table"]);
      expect(t.code).toBe(1);
      expect(t.out).toContain("FAIL  checkout zsa/moonlander");
      expect(t.out).toContain("not the pinned 93b2b9ec3368f86c5eb5a2e3f934049f8daef885");
    }, { FAKE_GIT_HEAD: "1".repeat(40) });
  });
});
