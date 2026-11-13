// Real mount enforcement, using only a synthetic source repository and scratch workspace.
import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { prepareWestWorkspace } from "../../../src/firmware/zmk/west-workspace.ts";
import { capture } from "../../../src/firmware/toolchain/run.ts";
import { originRepo } from "../../helpers/git-fixture.ts";
import { tempDir } from "../../helpers/tmp.ts";

const image = "zmkfirmware/zmk-build-arm@sha256:edb1c953438c6f720ddb79c3762f3972013b7fbbaf4fff3592fc869983e7afc5";

test.skipIf(process.env.KEYLOOM_DOCKER_TESTS !== "1")("a container cannot alter trusted source or Git through a west mount", async () => {
  // Colima shares the home directory. The caller sets TMPDIR to scratch space there.
  const workspace = join(tempDir(), "work");
  const origin = originRepo();
  const mounts = await prepareWestWorkspace(workspace, [{ name: "zmk", url: origin.url, revision: origin.sha }], image);
  await mkdir(join(workspace, "config"));
  const result = await capture([
    "docker", "run", "--rm", "-v", `${workspace}:/work`, ...mounts, image, "sh", "-c",
    "set -e; test -f /work/zmk/Makefile; if printf changed > /work/zmk/Makefile; then exit 41; fi; if printf changed >> /work/zmk/.git/config; then exit 42; fi; printf output > /work/config/output",
  ], { timeoutMs: 60_000 });
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain("Read-only file system");
  expect(await Bun.file(join(workspace, "config", "output")).text()).toBe("output");
}, 90_000);
