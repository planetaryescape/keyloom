import { expect, test } from "bun:test";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { flashUf2Drives } from "../../../src/firmware/zmk/flash.ts";
import { LogSink } from "../../../src/firmware/toolchain/run.ts";
import { lsblkFinder, volumeFinderAt } from "../../../src/firmware/zmk/volumes.ts";
import { fakeBinDir, withPath } from "../../helpers/fake-bin.ts";
import { tempDir } from "../../helpers/tmp.ts";
import { uf2Image } from "../../helpers/zmk.ts";

async function setup() {
  const dir = tempDir();
  const root = join(dir, "Volumes");
  const mount = join(root, "NICENANO");
  mkdirSync(mount, { recursive: true });
  const artifactPath = join(dir, "image.uf2");
  await Bun.write(artifactPath, uf2Image(0xada52840, 2));
  const steps = ["left half", "right half"].map((label) => ({ label, volume: "NICENANO", enter: "Press reset." }));
  const flash = (over: Partial<Parameters<typeof flashUf2Drives>[0]> = {}) => flashUf2Drives({
    artifactPath, shape: "single", steps, findVolume: volumeFinderAt(root),
    hooks: { enterBootloader: async () => ({ ok: true }), peersRunning: async () => true },
    log: new LogSink(join(dir, "flash.log")), onState: () => {},
    writeRetryMs: 200, pollMs: 20, bootloaderWaitMs: 100, unmountWaitMs: 20, ...over,
  });
  // Keeping the old directory ensures the replacement has a different inode.
  const swap = () => { renameSync(mount, join(dir, "departed")); mkdirSync(mount); };
  return { dir, root, mount, swap, flash };
}

for (const code of ["EACCES", "EPERM"]) {
  test(`a ${code} retry refuses a replacement drive at the same path`, async () => {
    const s = await setup();
    let writes = 0;
    const result = await s.flash({ writeImage: async (path, bytes) => {
      if (++writes === 1) {
        setTimeout(s.swap, 5);
        throw Object.assign(new Error("temporarily denied"), { code });
      }
      await writeFile(path, bytes);
    } });
    expect(writes).toBe(1);
    expect(existsSync(join(s.mount, "glove80.uf2"))).toBe(false);
    expect(result.error).toContain("mount identity changed");
  });

  test(`a ${code} retry rechecks shared-label peers`, async () => {
    const s = await setup();
    let running = true;
    let writes = 0;
    const result = await s.flash({
      hooks: { enterBootloader: async () => ({ ok: true }), peersRunning: async () => running },
      writeImage: async (path, bytes) => {
        if (++writes === 1) {
          setTimeout(() => { running = false; }, 5);
          throw Object.assign(new Error("temporarily denied"), { code });
        }
        await writeFile(path, bytes);
      },
    });
    expect(writes).toBe(1);
    expect(result.error).toContain("other half is not confirmed running firmware");
  });
}

test("a peer check that swaps the selected drive refuses the first write", async () => {
  const s = await setup();
  let writes = 0;
  const result = await s.flash({
    hooks: { enterBootloader: async () => ({ ok: true }), peersRunning: async () => { s.swap(); return true; } },
    writeImage: async () => { writes++; },
  });
  expect(writes).toBe(0);
  expect(result.error).toContain("mount identity changed");
});

test("a retry refuses a different mount path returned for the label", async () => {
  const s = await setup();
  const replacement = join(s.dir, "replacement");
  mkdirSync(replacement);
  let found = s.mount;
  let writes = 0;
  const result = await s.flash({ findVolume: async () => found, writeImage: async () => {
    writes++;
    setTimeout(() => { found = replacement; }, 5);
    throw Object.assign(new Error("temporarily denied"), { code: "EACCES" });
  } });
  expect(writes).toBe(1);
  expect(result.error).toContain("no longer mounted at that path");
});

test("a failed peer probe on retry stops without another write", async () => {
  const s = await setup();
  let writes = 0;
  const result = await s.flash({
    hooks: { enterBootloader: async () => ({ ok: true }), peersRunning: async () => {
      if (writes) throw new Error("peer enumeration failed");
      return true;
    } },
    writeImage: async () => { writes++; throw Object.assign(new Error("temporarily denied"), { code: "EPERM" }); },
  });
  expect(writes).toBe(1);
  expect(result.error).toContain("peer enumeration failed");
});

test.each(["retry", "sync"])("a drive disappearing before %s cannot be taken as a completed write", async (phase) => {
  const s = await setup();
  let writes = 0;
  const disappear = () => renameSync(s.mount, join(s.dir, "departed"));
  const result = await s.flash({ writeImage: async (path, bytes) => {
    writes++;
    if (phase === "retry") {
      if (writes === 1) setTimeout(disappear, 5);
      throw Object.assign(new Error("temporarily denied"), { code: "EACCES" });
    }
    await writeFile(path, bytes);
    disappear();
  } });
  expect(writes).toBe(1);
  expect(result.state).toBe("failed");
  expect(result.error).toContain("no longer mounted at that path");
});

test("the final sync refuses a replacement mount", async () => {
  const s = await setup();
  const result = await s.flash({ writeImage: async (path, bytes) => { await writeFile(path, bytes); s.swap(); } });
  expect(result.error).toContain("mount identity changed");
  expect(existsSync(join(s.mount, "glove80.uf2"))).toBe(false);
});

test("the final sync rechecks shared-label peers", async () => {
  const s = await setup();
  let running = true;
  const result = await s.flash({
    hooks: { enterBootloader: async () => ({ ok: true }), peersRunning: async () => running },
    writeImage: async (path, bytes) => { await writeFile(path, bytes); running = false; },
  });
  expect(result.error).toContain("other half is not confirmed running firmware");
});

test.each([false, true])("duplicate macOS label mounts are ambiguous (canonical=%s)", async (canonical) => {
  const s = await setup();
  if (!canonical) renameSync(s.mount, join(s.root, "NICENANO 2"));
  mkdirSync(join(s.root, "NICENANO 1"));
  await expect(volumeFinderAt(s.root)("NICENANO")).rejects.toThrow(/ambiguous.*NICENANO/i);
  let writes = 0;
  const result = await s.flash({ writeImage: async () => { writes++; } });
  expect(writes).toBe(0);
  expect(result.error).toMatch(/ambiguous.*NICENANO/i);
});

test("a duplicate label appearing during the retry window stops the next write", async () => {
  const s = await setup();
  let writes = 0;
  const result = await s.flash({ writeImage: async () => {
    writes++;
    if (writes === 1) setTimeout(() => mkdirSync(join(s.root, "NICENANO 1")), 5);
    throw Object.assign(new Error("temporarily denied"), { code: "EACCES" });
  } });
  expect(writes).toBe(1);
  expect(result.error).toMatch(/ambiguous.*NICENANO/i);
});

test("two Linux mounts with one label are ambiguous", async () => {
  const bin = fakeBinDir({ lsblk: "echo 'NICENANO /fake/left'\necho 'NICENANO /fake/right'" });
  await withPath(bin, async () => {
    await expect(lsblkFinder()("NICENANO")).rejects.toThrow(/ambiguous.*NICENANO/i);
  });
});
