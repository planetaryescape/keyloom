// Flashing is only ever tested against a temporary directory standing in for /Volumes. A real flash
// is BK's done-check, never a test (and test/helpers/no-real-flash.ts makes sure of it).
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { FlashState } from "../../../src/firmware/toolchain/flash-state.ts";
import { LogSink } from "../../../src/firmware/toolchain/run.ts";
import { zmkRevision } from "../../../src/firmware/zmk/board-config.ts";
import { flashUf2Drives } from "../../../src/firmware/zmk/flash.ts";
import * as volumes from "../../../src/firmware/zmk/volumes.ts";
import { combinedUf2, glove80, uf2Image } from "../../helpers/zmk.ts";
import { tempDir } from "../../helpers/tmp.ts";

const steps = zmkRevision((await glove80()).definition).flash.steps;
const [RIGHT, LEFT] = steps.map((s) => s.volume) as [string, string];

/**
 * A fake bootloader: when keyloom writes a .uf2 into a volume, the volume goes away after `delayMs`, the
 * way a real UF2 bootloader unmounts itself. `stays` leaves one mounted, as a bootloader that refused the file would.
 */
function fakeBootloader(root: string, opts: { delayMs?: number; stays?: string[] } = {}) {
  const written: string[] = [];
  const timer = setInterval(() => {
    for (const name of readdirSync(root)) {
      const file = join(root, name, "glove80.uf2");
      if (existsSync(file) && !written.includes(name)) {
        written.push(name);
        if (!opts.stays?.includes(name)) setTimeout(() => rmSync(join(root, name), { recursive: true, force: true }), opts.delayMs ?? 30);
      }
    }
  }, 10);
  return { written, stop: () => clearInterval(timer) };
}

const mount = (root: string, label: string, after = 0) => setTimeout(() => mkdirSync(join(root, label), { recursive: true }), after);

async function setup(bytes: Uint8Array = combinedUf2()) {
  const dir = tempDir();
  const root = join(dir, "Volumes");
  mkdirSync(root);
  const artifact = join(dir, "glove80.uf2");
  await Bun.write(artifact, bytes);
  const states: Array<[FlashState, string | null]> = [];
  const lines: string[] = [];
  const log = new LogSink(join(dir, "flash.log"));
  const flash = (over: Partial<Parameters<typeof flashUf2Drives>[0]> = {}) =>
    flashUf2Drives({
      artifactPath: artifact, steps, findVolume: volumes.volumeFinderAt(root), log, onState: (s, i) => states.push([s, i]), onLine: (l) => lines.push(l),
      pollMs: 10, bootloaderWaitMs: 1500, unmountWaitMs: 500, ...over,
    });
  return { dir, root, artifact, states, lines, log, flash };
}

describe("flashUf2Drives (a temporary directory for /Volumes)", () => {
  test("flashes the right half, then the left, each when its drive appears, and succeeds when both drives unmount", async () => {
    const s = await setup();
    const boot = fakeBootloader(s.root);
    mount(s.root, RIGHT, 50);
    mount(s.root, LEFT, 600);
    const r = await s.flash();
    boot.stop();
    expect(r).toMatchObject({ state: "succeeded", error: null });
    expect(boot.written).toEqual([RIGHT, LEFT]);
    expect(s.states.map(([st]) => st)).toEqual(["waiting_for_bootloader", "writing", "waiting_for_bootloader", "writing", "succeeded"]);
    // What the person is asked to do changes with the half.
    expect(s.states[0]?.[1]).toContain("Flash the right half (1 of 2). With the right half switched off");
    expect(s.states[2]?.[1]).toContain("Flash the left half (2 of 2). With the left half switched off");
    expect(s.states[1]?.[1]).toContain("Don't unplug");
  });

  test("the file written to each drive is the artifact, byte for byte", async () => {
    const s = await setup();
    mount(s.root, RIGHT, 20);
    const seen: Uint8Array[] = [];
    // setInterval doesn't wait for an async tick, so under load two ticks could both read the same drive before either removed it.
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const f = Bun.file(join(s.root, RIGHT, "glove80.uf2"));
        if (await f.exists()) {
          seen.push(new Uint8Array(await f.arrayBuffer()));
          rmSync(join(s.root, RIGHT), { recursive: true, force: true });
          mount(s.root, LEFT, 10);
        }
        const l = Bun.file(join(s.root, LEFT, "glove80.uf2"));
        if (await l.exists()) {
          seen.push(new Uint8Array(await l.arrayBuffer()));
          rmSync(join(s.root, LEFT), { recursive: true, force: true });
        }
      } finally {
        busy = false;
      }
    }, 10);
    const r = await s.flash();
    clearInterval(timer);
    expect(r.state).toBe("succeeded");
    expect(seen).toHaveLength(2);
    for (const bytes of seen) expect(bytes).toEqual(combinedUf2());
  });

  test("nothing appearing within the wait fails with nothing flashed, and the left half is never reached", async () => {
    const s = await setup();
    const r = await s.flash({ bootloaderWaitMs: 150 });
    expect(r.state).toBe("failed");
    expect(r.error).toContain(`${RIGHT} didn't appear within`);
    expect(r.error).toContain("Nothing was flashed");
    expect(s.states.map(([st]) => st)).toEqual(["waiting_for_bootloader", "failed"]);
  });

  test("the right half flashed and the left never appearing says which half is on the new firmware", async () => {
    const s = await setup();
    const boot = fakeBootloader(s.root);
    mount(s.root, RIGHT, 20);
    const r = await s.flash({ bootloaderWaitMs: 400 });
    boot.stop();
    expect(r.state).toBe("failed");
    expect(r.error).toContain("The right half was flashed and the left half was not");
  });

  test("a drive that stays mounted after the copy means the bootloader didn't take the file", async () => {
    const s = await setup();
    const boot = fakeBootloader(s.root, { stays: [RIGHT] });
    mount(s.root, RIGHT, 20);
    const r = await s.flash({ unmountWaitMs: 200 });
    boot.stop();
    expect(r.state).toBe("failed");
    expect(r.error).toContain(`${RIGHT} was still mounted`);
    expect(r.error).toContain("The right half was not flashed");
    expect(boot.written).toEqual([RIGHT]);
  });

  test("a copy that fails while the drive is still there fails the flash with the reason", async () => {
    const s = await setup();
    // A directory where the file must go makes the copy fail without the drive going away.
    mkdirSync(join(s.root, RIGHT, "glove80.uf2"), { recursive: true });
    const r = await s.flash();
    expect(r.state).toBe("failed");
    expect(r.error).toContain("Copying to");
    expect(r.error).toContain("The right half was not flashed");
  });

  test("a drive keyloom may not write to says how to allow it", async () => {
    const s = await setup();
    mkdirSync(join(s.root, RIGHT), { recursive: true });
    chmodSync(join(s.root, RIGHT), 0o555);
    try {
      const r = await s.flash({ writeRetryMs: 100 });
      expect(r.state).toBe("failed");
      expect(r.error).toContain("EACCES");
      expect(r.error).toContain("The right half was not flashed. keyloom wasn't allowed to write to the drive.");
      expect(r.error).toContain("Files & Folders");
    } finally {
      chmodSync(join(s.root, RIGHT), 0o755);
    }
  });

  test("a freshly mounted drive that refuses the write at first is written once it allows it", async () => {
    const s = await setup();
    mkdirSync(join(s.root, RIGHT), { recursive: true });
    chmodSync(join(s.root, RIGHT), 0o555);
    // The drive starts refusing, then allows the write, and the bootloader takes the drive away once the file lands.
    setTimeout(() => chmodSync(join(s.root, RIGHT), 0o755), 120);
    const watch = setInterval(() => {
      if (existsSync(join(s.root, RIGHT, "glove80.uf2"))) {
        clearInterval(watch);
        rmSync(join(s.root, RIGHT), { recursive: true, force: true });
      }
    }, 10);
    const r = await s.flash({ steps: [steps[0] as (typeof steps)[number]], writeRetryMs: 2000 });
    clearInterval(watch);
    expect(r.state).toBe("succeeded");
    expect(s.lines.some((l) => l.includes("refused the write (EACCES); trying again"))).toBe(true);
  });

  test("a copy that errors because the bootloader took the drive away mid-write counts as written", async () => {
    const s = await setup();
    // A directory where the file must go makes the copy fail; the finder then reports each drive gone, as a
    // bootloader that reboots on the last block would leave it.
    for (const label of [RIGHT, LEFT]) mkdirSync(join(s.root, label, "glove80.uf2"), { recursive: true });
    const real = volumes.volumeFinderAt(s.root);
    const seen = new Map<string, number>();
    const r = await s.flash({
      findVolume: async (label) => {
        const n = (seen.get(label) ?? 0) + 1;
        seen.set(label, n);
        return n === 1 ? real(label) : null;
      },
    });
    expect(r.state).toBe("succeeded");
    expect(s.lines.some((l) => l.includes(`${RIGHT} has unmounted, so the write is taken as done`))).toBe(true);
  });

  test("a device-gone write error while the drive is still listed waits for it to unmount, then counts as written", async () => {
    const s = await setup();
    // BK's Glove80 left half, 2026-10-16: the bootloader rebooted on the last block, the write failed with ENXIO, and macOS still
    // listed the drive for a moment. The half came back running the new build.
    for (const label of [RIGHT, LEFT]) mkdirSync(join(s.root, label), { recursive: true });
    const real = volumes.volumeFinderAt(s.root);
    const looks = new Map<string, number>();
    const r = await s.flash({
      writeImage: async () => {
        throw Object.assign(new Error("ENXIO: no such device or address, write"), { code: "ENXIO" });
      },
      findVolume: async (label) => {
        const n = (looks.get(label) ?? 0) + 1;
        looks.set(label, n);
        return n <= 4 ? real(label) : null;
      },
      goneWaitMs: 1000,
    });
    expect(r.state).toBe("succeeded");
    expect(s.lines.some((l) => l.includes("ENXIO") && l.includes(`${RIGHT} has unmounted, so the write is taken as done`))).toBe(true);
  });

  test("a device-gone write error on a drive that stays mounted still fails, after the wait", async () => {
    const s = await setup();
    for (const label of [RIGHT, LEFT]) mkdirSync(join(s.root, label), { recursive: true });
    const r = await s.flash({
      writeImage: async () => {
        throw Object.assign(new Error("ENXIO: no such device or address, write"), { code: "ENXIO" });
      },
      goneWaitMs: 100,
    });
    expect(r.state).toBe("failed");
    expect(r.error).toContain("The right half was not flashed");
  });

  test("an artifact that isn't a Glove80 UF2 is refused before any drive is looked at", async () => {
    const one = await setup(uf2Image(0x9807b007, 3));
    expect((await one.flash()).error).toContain("Not flashing: it holds 1 UF2 image");
    const missing = await setup();
    rmSync(missing.artifact);
    expect((await missing.flash()).error).toContain("doesn't exist; build it again");
    expect(missing.states.map(([st]) => st)).toEqual(["failed"]);
  });

  test("cancelling while waiting stops without writing anything", async () => {
    const s = await setup();
    const c = new AbortController();
    setTimeout(() => c.abort(), 80);
    const r = await s.flash({ signal: c.signal, bootloaderWaitMs: 5000 });
    expect(r).toMatchObject({ state: "failed", error: "Cancelled. Nothing was flashed." });
  });

  test("cancelling before the left half says the right is already flashed", async () => {
    const s = await setup();
    const boot = fakeBootloader(s.root);
    mount(s.root, RIGHT, 20);
    const c = new AbortController();
    setTimeout(() => c.abort(), 400);
    const r = await s.flash({ signal: c.signal, bootloaderWaitMs: 5000 });
    boot.stop();
    expect(r.error).toContain("The halves flashed so far keep the new firmware");
  });
});

describe("volumes", () => {
  test("a volume is a directory under the root named by its label", async () => {
    const root = tempDir();
    mkdirSync(join(root, RIGHT));
    await Bun.write(join(root, LEFT), "a file, not a drive");
    const find = volumes.volumeFinderAt(root);
    expect(await find(RIGHT)).toBe(join(root, RIGHT));
    expect(await find(LEFT)).toBeNull();
    expect(await find("OTHER")).toBeNull();
  });

  test("under test the machine's own mount root can't be resolved, whichever way it is asked for", () => {
    expect(() => volumes.defaultVolumesRoot()).toThrow(/tests must flash into a temporary directory/);
    expect(() => volumes.defaultVolumeFinder()).toThrow(/tests must flash/);
    expect(() => volumes.lsblkFinder()).toThrow(/tests must flash/);
    for (const real of ["/Volumes", "/Volumes/", "/run/media/bk", "/media", "/mnt/x", "/Volumes/../Volumes"]) {
      expect(() => volumes.volumeFinderAt(real)).toThrow(/tests must flash/);
    }
    expect(() => volumes.volumeFinderAt(tempDir())).not.toThrow();
  });
});
