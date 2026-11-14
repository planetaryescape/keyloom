import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ensureSourceVolume } from "../../../src/firmware/toolchain/source-volume.ts";
import { fakeBinDir, withPath } from "../../helpers/fake-bin.ts";
import { tempDir } from "../../helpers/tmp.ts";

const docker = `
printf '%s\\n' "$*" >> "$CALLS"
case "$1:$2" in
  volume:create)
    key=""; prev=""; name=""
    for a in "$@"; do [ "$prev" = --label ] && key="\${a#*=}"; prev="$a"; name="$a"; done
    mkdir -p "$VOLUMES"; printf '%s' "$key" > "$VOLUMES/$name"; exit 0;;
  volume:inspect)
    for a in "$@"; do name="$a"; done
    [ -f "$VOLUMES/$name" ] || { echo "no such volume" >&2; exit 1; }
    cat "$VOLUMES/$name"; exit 0;;
  volume:rm)
    for a in "$@"; do name="$a"; done
    rm -f "$VOLUMES/$name"; exit 0;;
  run:*)
    [ "$SEED_FAIL" = 1 ] && { echo "copy failed" >&2; exit 23; }
    [ "$SEED_HANG" = 1 ] && { echo SEED_READY; exec sleep 60; }
    exit 0;;
  rm:*) exit 0;;
esac
exit 9
`;

async function fixture(extra: Record<string, string> = {}) {
  const dir = tempDir();
  const trusted = join(dir, "trusted");
  await Bun.write(join(trusted, "Makefile"), "approved source");
  const workspace = join(dir, "work");
  await Bun.write(join(workspace, "Makefile"), "poisoned output");
  const vars = { CALLS: join(dir, "calls"), VOLUMES: join(dir, "volumes"), ...extra };
  const bin = fakeBinDir({ docker });
  const identity = "a".repeat(64);
  const record = join(`${workspace}.source-volumes-v2`, `${identity}.json`);
  const prepare = (hooks: Parameters<typeof ensureSourceVolume>[4] = {}) => ensureSourceVolume(workspace, identity, "pinned-image", [{ dir: trusted, path: "zmk" }], hooks);
  return { dir, trusted, workspace, vars, bin, record, prepare };
}

test("warm source reuse ignores poisoned workspace output and replaces a pruned volume", async () => {
  const f = await fixture();
  await withPath(f.bin, async () => {
    const first = await f.prepare();
    await Bun.write(join(f.workspace, ".git", "config"), "untrusted Git configuration");
    expect(await f.prepare()).toBe(first);
    const calls = await Bun.file(f.vars.CALLS).text();
    expect(calls.split("\n").filter((line) => line.startsWith("run "))).toHaveLength(1);
    expect(calls).toContain(`src=${f.trusted}.source-v2.tar,dst=/archives/0.tar,readonly`);
    expect(calls).not.toContain(`src=${f.workspace},`);
    expect(calls).not.toContain("--privileged");
    await Bun.$`rm ${join(f.vars.VOLUMES, first)}`.quiet();
    expect(await f.prepare()).not.toBe(first);
  }, f.vars);
});

test("failed or cancelled source copying publishes no reusable cache and a retry succeeds", async () => {
  for (const mode of ["SEED_FAIL", "SEED_HANG"]) {
    const f = await fixture({ [mode]: "1" });
    const cancel = new AbortController();
    await withPath(f.bin, async () => {
      await expect(f.prepare({ signal: cancel.signal, onLine: (line) => { if (line === "SEED_READY") cancel.abort(); } })).rejects.toThrow(mode === "SEED_FAIL" ? /copy failed/ : /cancelled/);
    }, f.vars);
    expect(existsSync(f.record)).toBe(false);
    await withPath(f.bin, async () => { expect(await f.prepare()).toStartWith("keyloom-source-"); }, { ...f.vars, [mode]: "0" });
    expect(existsSync(f.record)).toBe(true);
  }
});

test("a failed archive is removed before any Docker cache can be published", async () => {
  const f = await fixture();
  const bin = fakeBinDir({ docker, tar: 'printf partial > "$2"; echo "archive failed" >&2; exit 1' });
  await withPath(bin, async () => { await expect(f.prepare()).rejects.toThrow(/archive failed/); }, f.vars);
  expect(existsSync(`${f.trusted}.source-v2.tar`)).toBe(false);
  expect(existsSync(f.record)).toBe(false);
  expect(existsSync(f.vars.CALLS)).toBe(false);
});
