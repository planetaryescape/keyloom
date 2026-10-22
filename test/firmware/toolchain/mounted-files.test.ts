import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { BuildFailure } from "../../../src/firmware/toolchain/build-failure.ts";
import { awaitMountedFiles } from "../../../src/firmware/toolchain/mounted-files.ts";
import { LogSink } from "../../../src/firmware/toolchain/run.ts";
import { fakeBinDir, fakeSha256Probe, withPath } from "../../helpers/fake-bin.ts";
import { tempDir } from "../../helpers/tmp.ts";

const FAKE_DOCKER = `
echo "$@" >> "$FAKE_DOCKER_LOG"
sleep "\${FAKE_PROBE_SECONDS:-0}"
vol=""; prev=""
for a in "$@"; do [ "$prev" = "-v" ] && vol="\${a%%:/mnt}"; prev="$a"; done
${fakeSha256Probe("/mnt")}
exit 9`;

async function setup() {
  const dir = tempDir();
  const root = join(dir, "mounted");
  await Bun.write(join(root, "a", "default.nix"), "{ new = true; }\n");
  await Bun.write(join(root, "b.conf"), "x\n");
  const log = new LogSink(join(dir, "check.log"));
  const bin = fakeBinDir({ docker: FAKE_DOCKER });
  const check = (env: Record<string, string>, over: { settleMs?: number; files?: string[]; signal?: AbortSignal } = {}) =>
    withPath(
      bin,
      () =>
        awaitMountedFiles({
          // Four subprocess probes can exceed 200 ms on a loaded runner; the failure case supplies its own short deadline.
          image: "img", mountArgs: ["-v", `${root}:/mnt`], hostRoot: root, containerRoot: "/mnt", log, retryEveryMs: 10, settleMs: over.settleMs ?? 3_000,
          files: over.files ?? [join(root, "a", "default.nix"), join(root, "b.conf")], ...(over.signal ? { signal: over.signal } : {}),
        }),
      { FAKE_DOCKER_LOG: join(dir, "docker.calls"), ...env },
    );
  const calls = async () => (await Bun.file(join(dir, "docker.calls")).text()).split("\n").filter((l) => l !== "");
  return { check, calls, root, log, dir };
}

describe("awaitMountedFiles", () => {
  test("one docker run of the image's sha256sum is enough when the container sees the host's files", async () => {
    const s = await setup();
    await s.check({});
    const calls = await s.calls();
    expect(calls).toEqual([`run --rm -v ${s.root}:/mnt --entrypoint sha256sum img /mnt/a/default.nix /mnt/b.conf`]);
  });

  test("retries while the container sees another copy, then goes on", async () => {
    const s = await setup();
    await s.check({ FAKE_STALE_CALLS: "3" });
    expect(await s.calls()).toHaveLength(4);
  });

  test("slow probes still get enough time to retry a view that settles", async () => {
    const s = await setup();
    await s.check({ FAKE_STALE_CALLS: "3", FAKE_PROBE_SECONDS: "0.08" });
    expect(await s.calls()).toHaveLength(4);
  });

  test("a container that never agrees fails the build, naming the files and the way out", async () => {
    const s = await setup();
    const result = s.check({ FAKE_STALE_CALLS: "forever" }, { settleMs: 50 });
    await expect(result).rejects.toBeInstanceOf(BuildFailure);
    await expect(result).rejects.toThrow(/still sees an old or missing copy of a\/default\.nix, b\.conf after 0 s.*colima restart/);
  });

  test("a cancelled build stops waiting", async () => {
    const s = await setup();
    const abort = new AbortController();
    abort.abort();
    await expect(s.check({ FAKE_STALE_CALLS: "forever" }, { signal: abort.signal })).rejects.toThrow(/cancelled/);
  });
});
