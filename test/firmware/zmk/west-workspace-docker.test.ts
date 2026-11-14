// Real mount enforcement, using only a synthetic source repository and scratch workspace.
import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { withWestWorkspace } from "../../../src/firmware/zmk/west-workspace.ts";
import { capture } from "../../../src/firmware/toolchain/run.ts";
import { withWorkspace } from "../../../src/firmware/toolchain/workspace.ts";
import { originRepo } from "../../helpers/git-fixture.ts";
import { tempDir } from "../../helpers/tmp.ts";

const image = "zmkfirmware/zmk-build-arm@sha256:edb1c953438c6f720ddb79c3762f3972013b7fbbaf4fff3592fc869983e7afc5";

test.skipIf(process.env.KEYLOOM_DOCKER_TESTS !== "1")("a container cannot alter trusted source or Git through a west mount", async () => {
  // Colima shares the home directory. The caller sets TMPDIR to scratch space there.
  const workspace = join(tempDir(), "work");
  const origin = originRepo();
  let volume = "";
  try { await withWestWorkspace(workspace, [{ name: "zmk", url: origin.url, revision: origin.sha }], image, {}, async (workspace, mounts) => {
  volume = mounts.join(" ").match(/src=([^,]+),dst=\/keyloom-sources/)?.[1] ?? "";
  await mkdir(join(workspace, "config"));
  const result = await capture([
    "docker", "run", "--rm", "-v", `${workspace}:/work`, ...mounts, image, "sh", "-c",
    'set -e; test -f /keyloom-sources/zmk/Makefile; if printf changed > /keyloom-sources/zmk/Makefile; then exit 41; fi; if printf changed >> /keyloom-sources/zmk/.git/config; then exit 42; fi; cd /keyloom-sources/zmk; test "$(west topdir)" = /keyloom-sources; printf output > /work/config/output',
  ], { timeoutMs: 60_000 });
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain("Read-only file system");
  expect(await Bun.file(join(workspace, "config", "output")).text()).toBe("output");
  }); } finally { if (volume) await capture(["docker", "volume", "rm", volume], { timeoutMs: 30_000 }); }
}, 90_000);

test.skipIf(process.env.KEYLOOM_DOCKER_TESTS !== "1")("an orphan using the stable bind cannot change a later run's inputs", async () => {
  const base = join(tempDir(), "work");
  await mkdir(base);
  await Bun.write(join(base, "source"), "old source");
  const name = `keyloom-workspace-probe-${process.pid}-${Date.now()}`;
  const started = await capture(["docker", "run", "--rm", "-d", "--name", name, "-v", `${base}:/work`, image, "sh", "-c", "sleep 60"], { timeoutMs: 15_000 });
  try {
    expect(started.exitCode).toBe(0);
    const paths: string[] = [];
    for (const source of ["first approved source", "second approved source"]) {
      await withWorkspace(base, async (dir) => {
        paths.push(dir);
        await Bun.write(join(dir, "source"), source);
        const write = await capture(["docker", "exec", name, "sh", "-c", "printf orphan-write > /work/source"], { timeoutMs: 15_000 });
        expect(write.exitCode).toBe(0);
        expect(await Bun.file(join(dir, "source")).text()).toBe(source);
      });
    }
    expect(paths[0]).not.toBe(paths[1]);
  } finally {
    await capture(["docker", "rm", "-f", name], { timeoutMs: 15_000 });
  }
}, 90_000);
