// Flashing a west build's bundle: each half gets its own UF2 from the zip, both through one boot-drive
// label (a nice!nano shows up as NICENANO every time). A temporary directory stands in for /Volumes.
import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { LogSink } from "../../../src/firmware/toolchain/run.ts";
import { type FlashStep, flashUf2Drives } from "../../../src/firmware/zmk/flash.ts";
import * as volumes from "../../../src/firmware/zmk/volumes.ts";
import { combinedUf2, uf2Image } from "../../helpers/zmk.ts";
import { tempDir } from "../../helpers/tmp.ts";

const LABEL = "NICENANO";
const steps: FlashStep[] = [
  { volume: LABEL, label: "left half", target: "left", enter: "Double-tap reset on the left." },
  { volume: LABEL, label: "right half", target: "right", enter: "Double-tap reset on the right." },
];
const left = uf2Image(0xada52840, 3);
const right = uf2Image(0xada52840, 5);

/** The drive appears, takes a file, and unmounts; then appears again for the next half. */
function fakeNiceNano(root: string, times: number, handsFree = false) {
  const received: Uint8Array[] = [];
  const names: string[] = [];
  const drive = join(root, LABEL);
  if (!handsFree) mkdirSync(drive, { recursive: true });
  // A real bootloader acts once the whole file is in. Taking it at first sight raced the copy on a
  // slow CI runner (seen 2026-10-15), so wait until its size holds still across two ticks.
  let lastSize = -1;
  const timer = setInterval(() => {
    const other = readdirNames(drive);
    if (other.length === 0) return;
    const size = statSync(join(drive, other[0] as string)).size;
    if (size === 0 || size !== lastSize) {
      lastSize = size;
      return;
    }
    lastSize = -1;
    {
      names.push(...other);
      received.push(new Uint8Array(readFileSync(join(drive, other[0] as string))));
      rmSync(drive, { recursive: true, force: true });
      if (!handsFree && received.length < times) setTimeout(() => mkdirSync(drive, { recursive: true }), 80);
    }
  }, 10);
  return { received, names, restart: async () => { mkdirSync(drive, { recursive: true }); return { ok: true as const }; }, stop: () => clearInterval(timer) };
}
const readdirNames = (d: string): string[] => (existsSync(d) ? readdirSync(d) : []);

async function setup(artifact: Uint8Array, name = "bld.zip") {
  const dir = tempDir();
  const root = join(dir, "Volumes");
  mkdirSync(root);
  const path = join(dir, name);
  await Bun.write(path, artifact);
  const lines: string[] = [];
  const flash = (over: Partial<Parameters<typeof flashUf2Drives>[0]> = {}) =>
    flashUf2Drives({
      artifactPath: path, steps, findVolume: volumes.volumeFinderAt(root), log: new LogSink(join(dir, "f.log")), onState: () => {},
      onLine: (l) => lines.push(l), pollMs: 10, bootloaderWaitMs: 4000, unmountWaitMs: 3000, driveFileName: "firmware.uf2", ...over,
    });
  return { root, flash, lines };
}

describe("flashUf2Drives with a bundle", () => {
  test("each half receives its own UF2, byte for byte, in step order", async () => {
    const s = await setup(zipSync({ "left.uf2": left, "right.uf2": right }));
    const boot = fakeNiceNano(s.root, 2, true);
    const r = await s.flash({ hooks: { enterBootloader: boot.restart } });
    boot.stop();
    expect(r).toMatchObject({ state: "succeeded", error: null });
    expect(boot.received).toEqual([left, right]);
    expect(boot.names).toEqual(["firmware.uf2", "firmware.uf2"]);
  });

  test("without hands-free hooks each half still receives its own UF2 through the manual flow", async () => {
    const s = await setup(zipSync({ "left.uf2": left, "right.uf2": right }));
    const boot = fakeNiceNano(s.root, 2);
    const r = await s.flash();
    boot.stop();
    expect(r).toMatchObject({ state: "succeeded", error: null });
    expect(boot.received).toEqual([left, right]);
  });

  test("a bundle missing a half's UF2 flashes nothing", async () => {
    const s = await setup(zipSync({ "left.uf2": left }));
    const r = await s.flash();
    expect(r.state).toBe("failed");
    expect(r.error).toContain("the build has no right.uf2 for the right half");
  });

  test("a bundle holding a UF2 that is two images joined is refused: a half's file is one image", async () => {
    const s = await setup(zipSync({ "left.uf2": combinedUf2(), "right.uf2": right }));
    const r = await s.flash();
    expect(r.state).toBe("failed");
    expect(r.error).toContain("single image");
  });

  test("a file that isn't a zip is refused with a sentence, not a stack trace", async () => {
    const s = await setup(new TextEncoder().encode("nope"), "bld.zip");
    const r = await s.flash();
    expect(r.error).toContain("isn't a readable bundle");
  });

  test("a plain single-image UF2 can be flashed to one step when the shape says single", async () => {
    const s = await setup(left, "bld.uf2");
    const boot = fakeNiceNano(s.root, 1);
    const r = await s.flash({ steps: [{ volume: LABEL, label: "board", enter: "Reset." }], shape: "single" });
    boot.stop();
    expect(r.state).toBe("succeeded");
    expect(boot.received).toEqual([left]);
  });

  test("without a shape, a plain single-image UF2 is still refused, as it was for the Glove80", async () => {
    const s = await setup(left, "bld.uf2");
    const r = await s.flash({ steps: [{ volume: LABEL, label: "board", enter: "Reset." }] });
    expect(r.error).toContain("one image per half");
  });

  test("without hands-free hooks a shared drive is written whether it appears after the prompt or was already mounted", async () => {
    // A normal first flash: nothing mounted, keyloom asks for the left half, and only then does its drive appear.
    // fakeNiceNano(..., true) never mounts by itself; the prompt mounts it, and the fake takes a file only once its size holds.
    const s = await setup(zipSync({ "left.uf2": left, "right.uf2": right }));
    const drive = join(s.root, LABEL);
    const fresh = fakeNiceNano(s.root, 2, true);
    let prompts = 0;
    const r = await s.flash({ onState: (state) => {
      if (state === "waiting_for_bootloader" && !existsSync(drive)) { prompts++; setTimeout(() => mkdirSync(drive, { recursive: true }), 50); }
    } });
    fresh.stop();
    expect(r.state).toBe("succeeded");
    expect(prompts).toBeGreaterThanOrEqual(2);
    expect(fresh.received).toEqual([left, right]);
    // Without hooks there is no rollback to protect, so an already mounted drive keeps the old manual behaviour
    // (hook-enabled refusal is covered in mount-binding and split-rollback tests).
    const t = await setup(zipSync({ "left.uf2": left, "right.uf2": right }));
    const boot = fakeNiceNano(t.root, 2);
    const manual = await t.flash();
    boot.stop();
    expect(manual.state).toBe("succeeded");
    expect(boot.received).toHaveLength(2);
  });
});
