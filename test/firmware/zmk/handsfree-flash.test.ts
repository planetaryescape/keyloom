// Hands-free flashing of ZMK halves against a fake keyboard: serial ports, boot drives and the halves' behaviour are fakes
// (test/helpers/fake-zmk-halves.ts), so nothing can reach a real keyboard.
import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadBoardDir } from "../../../src/boards/load.ts";
import { LogSink } from "../../../src/firmware/toolchain/run.ts";
import { flashUf2Drives } from "../../../src/firmware/zmk/flash.ts";
import { buildKey, halfMarker, keyInArtifact, keyInFirmware, parseSerial } from "../../../src/firmware/zmk/handsfree.ts";
import { type HalfTarget, halfTargets, portsOfHalf, readHalf, restartHalf, zmkHandsFreeHooks } from "../../../src/firmware/zmk/handsfree-flash.ts";
import { zmkRevision } from "../../../src/firmware/zmk/board-config.ts";
import { portOfAnotherBoard } from "../../../src/app/zmk-ports.ts";
import * as volumes from "../../../src/firmware/zmk/volumes.ts";
import { type FakeWorld, OLD_KEY, fakeWorld, glove80Image, serialOf, uf2Carrying } from "../../helpers/fake-zmk-halves.ts";
import { tempDir } from "../../helpers/tmp.ts";

const BUILD = "bld_01M509Z0DJYBG04NY1MKBCK6TY";
const KEY = "4NY1MKBCK6TY";
const GLOVE80 = await loadBoardDir(`${import.meta.dir}/../../../boards/moergo/glove80`);
const CORNE = await loadBoardDir(`${import.meta.dir}/../../../boards/foostan/corne`);

async function run(board: typeof GLOVE80, artifact: Uint8Array, world: (root: string) => FakeWorld, over: { buildId?: string; wait?: number; foreign?: boolean } = {}) {
  const dir = tempDir();
  const root = join(dir, "Volumes");
  mkdirSync(root);
  const file = join(dir, board === GLOVE80 ? "build.uf2" : "build.zip");
  await Bun.write(file, artifact);
  const w = world(root);
  const rev = zmkRevision(board.definition);
  const lines: string[] = [];
  const states: Array<[string, string | null]> = [];
  const saved: Array<[string, number]> = [];
  const findVolume = volumes.volumeFinderAt(root);
  const hooks = zmkHandsFreeHooks({
    deps: w.deps, board: board.definition, handsFree: rev.flash.handsFree as never, steps: rev.flash.steps, artifact, buildId: over.buildId ?? BUILD, findVolume,
    log: (l) => lines.push(l), ...(over.foreign ? { foreign: portOfAnotherBoard(board.definition.id) } : {}), saveLastGood: async (half, image) => void saved.push([half, image.length]),
  });
  const result = await flashUf2Drives({
    artifactPath: file, steps: rev.flash.steps, hooks, findVolume, log: new LogSink(join(dir, "f.log")), onState: (s, i) => states.push([s, i]),
    onLine: (l) => lines.push(l), pollMs: 10, bootloaderWaitMs: over.wait ?? 1500, unmountWaitMs: 1500,
    driveFileName: board === GLOVE80 ? "glove80.uf2" : "firmware.uf2",
  });
  w.stop();
  return { result, w, lines, states, saved };
}

const running = (letter: "L" | "R", key = OLD_KEY) => ({ letter, volume: letter === "L" ? "GLV80LHBOOT" : "GLV80RHBOOT", serial: serialOf(key, letter) });

describe("serial numbers and firmware files", () => {
  test("a build is named by the last 12 characters of its ID, and a serial is read back with its half and no chip ID", () => {
    expect(buildKey(BUILD)).toBe(KEY);
    expect(halfMarker(BUILD, "R")).toBe(`keyloom/${KEY}-R`);
    expect(parseSerial(`keyloom/${KEY}-L:GLV80-0123456789ABCDEF`)).toEqual({ key: KEY, half: "L" });
    expect(parseSerial(`keyloom/${KEY}-R`)).toEqual({ key: KEY, half: "R" });
    expect(() => buildKey("bld_short")).toThrow("isn't a build ID");
  });

  test("anything else is not keyloom's: other prefixes, a lower-case ID, another letter, junk after the letter", () => {
    for (const s of ["moergo.com:GLV80-58291CCA4B6E75B0", `keyloom/${KEY}`, `keyloom/${KEY.toLowerCase()}-L:X`, `keyloom/${KEY}-X:Y`, `keyloom/${KEY}-Lx`, `Keyloom/${KEY}-L`, `keyloom/YRHRBG0T2H8R`, undefined, ""]) {
      expect(parseSerial(s)).toBeUndefined();
    }
  });

  test("the key is found in a UF2 even when the template straddles two blocks, and not in a file without one", () => {
    expect(keyInFirmware(glove80Image(KEY))).toBe(KEY);
    expect(keyInFirmware(glove80Image(undefined))).toBeUndefined();
    // Raw bytes that look like the template but are not inside a UF2 block's payload are not read.
    const raw = new Uint8Array(512 * 2).fill(0x5a);
    expect(keyInFirmware(raw)).toBeUndefined();
  });
});

describe("which port is which half", () => {
  const targets = halfTargets(GLOVE80.definition, zmkRevision(GLOVE80.definition).flash.handsFree as never, zmkRevision(GLOVE80.definition).flash.steps);
  const left = targets.find((t) => t.half.marker === "L") as HalfTarget;
  const port = (serial: string | undefined, vendorId = 0x16c0, productId = 0x27db) => ({ vendorId, productId, ...(serial ? { serial } : {}), path: "/dev/x" });

  test("only a port of the half's own vendor and product with its letter counts", () => {
    const found = portsOfHalf(
      [port(serialOf(KEY, "L")), port(serialOf(KEY, "R")), port(serialOf(KEY, "L"), 0x1d50, 0x615e), port(serialOf(KEY, "L"), 0x16c0, 0x27d9), port("moergo.com:GLV80-1")],
      left,
    );
    expect(found.keyloom).toHaveLength(1);
    expect(found.other).toHaveLength(1);
  });

  test("driver diagnostics are neither keyloom nor other-firmware ports", () => {
    expect(portsOfHalf([
      { ...port(serialOf(KEY, "L")), driverMissing: true },
      { ...port("moergo.com:GLV80-TEST"), driverMissing: true },
    ], left)).toEqual({ keyloom: [], other: [] });
  });

  test("a right-half driver diagnostic uses the healthy central's 1201 relay", async () => {
    const right = targets.find((t) => t.half.marker === "R") as HalfTarget;
    const touches: Array<{ path: string; baud: number }> = [];
    const result = await restartHalf({
      deps: {
        serial: async () => ({
          list: async () => [
            { ...port(serialOf(KEY, "R"), 0x16c0, 0x27d9), path: "", driverMissing: true },
            { ...port(serialOf(KEY, "L")), path: "COM12" },
          ],
          touch: async (path, baud) => {
            touches.push({ path, baud });
            if (path !== "COM12" || baud !== 1201) throw new Error("unsupported");
          },
        }),
        usb: async () => { throw new Error("reboot-only must not enumerate USB"); },
      },
      targets, target: right, waitForVolume: false,
      findVolume: async () => { throw new Error("reboot-only must not probe volumes"); },
      log: () => {},
    });
    expect(result).toEqual({ ok: true });
    expect(touches).toEqual([{ path: "COM12", baud: 1201 }]);
  });

  test("a Corne half, whose IDs are unknown, takes any port with its letter and never calls an unmarked port its own", () => {
    const corne = halfTargets(CORNE.definition, zmkRevision(CORNE.definition).flash.handsFree as never, zmkRevision(CORNE.definition).flash.steps);
    const right = corne.find((t) => t.half.marker === "R") as HalfTarget;
    const found = portsOfHalf([port(serialOf(KEY, "R"), 0x1d50, 0x615e), port("ABC", 0x2341, 0x43), port(serialOf(KEY, "L"), 0x1d50, 0x615e)], right);
    expect(found.keyloom).toHaveLength(1);
    expect(found.other).toEqual([]);
  });

  test("a half running older firmware is seen through USB by its product ID", async () => {
    const deps = { serial: async () => ({ list: async () => [], touch: async () => {} }), usb: async () => [{ productId: "0x27db", vendorId: "0x16c0", name: "Glove80 Left", maker: "MoErgo", serial: "moergo.com:GLV80-1" }] };
    expect(await readHalf(deps, left)).toEqual({ state: "other", serial: "moergo.com:GLV80-1" });
    expect(await readHalf({ ...deps, usb: async () => [] }, left)).toEqual({ state: "absent" });
  });
});

describe("a Glove80 whose halves run keyloom's firmware", () => {
  test("flashes the right half and then the left with no keypress, and verifies both", async () => {
    const r = await run(GLOVE80, glove80Image(KEY), (root) => fakeWorld({ root, halves: [running("L"), running("R")] }));
    expect(r.result).toMatchObject({ state: "succeeded", error: null });
    // MoErgo's order: the right half first. 1200 baud on each half's own port; no relay was needed.
    expect(r.w.touches).toEqual([{ path: "/dev/fake-ttyACM-R", baud: 1200 }, { path: "/dev/fake-ttyACM-L", baud: 1200 }]);
    expect(r.w.flashed).toEqual([{ letter: "R", key: KEY }, { letter: "L", key: KEY }]);
    expect(r.lines.at(-1)).toBe(`keyloom: Verified: the right half is running build ${BUILD}, and the left half is running build ${BUILD}.`);
    expect(r.states.some(([, i]) => i?.includes("restarting the right half"))).toBe(true);
    expect(r.states.every(([, i]) => !i?.includes("hold I + PgDn") && !i?.includes("Magic"))).toBe(true);
    expect(r.saved.map(([h]) => h)).toEqual(["R", "L"]);
  });

  test("a half that shows on USB before its serial port is up is verified by its USB serial, not failed", async () => {
    // BK's Glove80, 2026-10-16: the right half came back as a USB device naming the new build a moment before its port appeared.
    const r = await run(GLOVE80, glove80Image(KEY), (root) => fakeWorld({ root, halves: [running("L"), running("R")], portLagMs: 300 }));
    expect(r.result).toMatchObject({ state: "succeeded", error: null });
    expect(r.w.flashed).toEqual([{ letter: "R", key: KEY }, { letter: "L", key: KEY }]);
    expect(r.lines.at(-1)).toBe(`keyloom: Verified: the right half is running build ${BUILD}, and the left half is running build ${BUILD}.`);
  });

  test("a right half with no port of its own is restarted through the left half at 1201 baud", async () => {
    const r = await run(GLOVE80, glove80Image(KEY), (root) => fakeWorld({ root, halves: [running("L"), { letter: "R", volume: "GLV80RHBOOT" }] }));
    expect(r.result.state).toBe("succeeded");
    expect(r.w.touches[0]).toEqual({ path: "/dev/fake-ttyACM-L", baud: 1201 });
    expect(r.w.touches[1]).toEqual({ path: "/dev/fake-ttyACM-L", baud: 1200 });
    expect(r.lines.some((l) => l.includes("over the split link"))).toBe(true);
  });

  test("the relay to a right half with no cable of its own falls back to the key combo, naming the cable", async () => {
    const r = await run(
      GLOVE80, glove80Image(KEY),
      (root) => {
        const w = fakeWorld({ root, halves: [running("L"), { letter: "R", volume: "GLV80RHBOOT", cabled: false }] });
        // The person notices the instruction and puts the right half in its bootloader with its cable in.
        setTimeout(() => { (w.halves[1] as { cabled: boolean }).cabled = true; w.press("R"); }, 900);
        return w;
      },
      { wait: 3000 },
    );
    expect(r.result.state).toBe("succeeded");
    const fallback = r.states.find(([, i]) => i?.includes("couldn't restart the right half by itself"));
    expect(fallback?.[1]).toContain("Is the right half's own USB cable plugged in?");
    expect(fallback?.[1]).toContain("Flash the right half (1 of 2)");
  });

  test("a half that comes back on the old build fails the flash, names both builds, and stops before the next half", async () => {
    const r = await run(GLOVE80, glove80Image(KEY), (root) => fakeWorld({ root, halves: [running("L"), running("R")], after: (h) => h.serial }));
    expect(r.result.state).toBe("failed");
    expect(r.result.error).toContain(`build ${OLD_KEY} and not ${BUILD}`);
    expect(r.result.error).toContain(halfMarker(BUILD, "R"));
    expect(r.w.flashed).toEqual([{ letter: "R", key: KEY }]);
    expect(r.saved).toEqual([]);
  });

  test("a half that never comes back fails with the bootloader rewrite first, then the cable, not a verified result", async () => {
    const r = await run(GLOVE80, glove80Image(KEY), (root) => fakeWorld({ root, halves: [running("L"), running("R")], after: () => undefined }));
    expect(r.result.state).toBe("failed");
    expect(r.result.error).toContain("didn't come back");
    // A truncated copy leaves a half that can't start; its own bootloader instruction is the fix, so it leads.
    expect(r.result.error).toContain("Its firmware may be incomplete. Put it in its bootloader and flash again:");
    expect(r.result.error).toMatch(/hold (I \+ PgDn|Magic \+ E) and switch it on/);
    const error = r.result.error ?? "";
    expect(error.indexOf("bootloader")).toBeLessThan(error.indexOf("USB cable"));
  });

  test("a half that comes back with a serial that is not keyloom's is named in the error", async () => {
    const r = await run(GLOVE80, glove80Image(KEY), (root) => fakeWorld({ root, halves: [running("L"), running("R")], after: () => "moergo.com:GLV80-1" }));
    expect(r.result.error).toContain("moergo.com:GLV80-1");
  });
});

describe("the first keyloom flash and failures to restart", () => {
  test("halves on firmware without the module are not touched; the key combo is asked for with the reason, and the flash still verifies", async () => {
    const r = await run(
      GLOVE80, glove80Image(KEY),
      (root) => {
        const w = fakeWorld({ root, halves: [{ letter: "L", volume: "GLV80LHBOOT" }, { letter: "R", volume: "GLV80RHBOOT" }] });
        setTimeout(() => w.press("R"), 150);
        setTimeout(() => w.press("L"), 700);
        return w;
      },
      { wait: 3000 },
    );
    expect(r.w.touches).toEqual([]);
    expect(r.states.some(([, i]) => i?.includes("no keyloom serial port was found for it, so it needs its bootloader key this once"))).toBe(true);
    expect(r.result.state).toBe("succeeded");
    expect(r.lines.at(-1)).toContain("Verified");
  });

  test("a failed touch (no permission) is a reason on the fallback, not a crash", async () => {
    const r = await run(
      GLOVE80, glove80Image(KEY),
      (root) => {
        const w = fakeWorld({ root, halves: [running("L"), running("R")], touchError: () => "no permission to open /dev/ttyACM0; add your user to the dialout (or uucp) group and log in again" });
        setTimeout(() => w.press("R"), 200);
        setTimeout(() => w.press("L"), 800);
        return w;
      },
      { wait: 3000 },
    );
    expect(r.states.some(([, i]) => i?.includes("dialout"))).toBe(true);
    expect(r.result.state).toBe("succeeded");
  });

  test("a touch that is sent but never shows the drive falls back after the restart wait, with that wait in the reason", async () => {
    const r = await run(
      GLOVE80, glove80Image(KEY),
      (root) => {
        // A half whose bootloader never mounts: cabled false makes the fake give up like a half on battery.
        const w = fakeWorld({ root, halves: [{ ...running("L"), cabled: false }, { ...running("R"), cabled: false }] });
        setTimeout(() => { for (const h of w.halves) h.cabled = true; w.press("R"); }, 1300);
        setTimeout(() => w.press("L"), 2200);
        return w;
      },
      { wait: 4000 },
    );
    expect(r.states.some(([, i]) => i?.includes("GLV80RHBOOT didn't appear within 1 seconds of restarting the right half"))).toBe(true);
    expect(r.result.state).toBe("succeeded");
  });

  test("a half already in its bootloader is not touched", async () => {
    const r = await run(
      GLOVE80, glove80Image(KEY),
      (root) => {
        const w = fakeWorld({ root, halves: [running("L"), running("R")] });
        mkdirSync(join(root, "GLV80RHBOOT"), { recursive: true });
        w.halves[1]!.mode = "boot";
        return w;
      },
    );
    expect(r.result.state).toBe("succeeded");
    expect(r.w.touches).toEqual([{ path: "/dev/fake-ttyACM-L", baud: 1200 }]);
    expect(r.lines.some((l) => l.includes("GLV80RHBOOT is already mounted"))).toBe(true);
  });

  test("two left halves of different builds are ambiguous: nothing is touched", async () => {
    const r = await run(
      GLOVE80, glove80Image(KEY),
      (root) => {
        const w = fakeWorld({ root, halves: [running("L"), running("R")] });
        const real = w.deps.serial;
        w.deps.serial = async () => {
          const t = await real();
          return { ...t, list: async () => [...(await t.list()), { vendorId: 0x16c0, productId: 0x27db, serial: serialOf("BBBBBBBBBBBB", "L"), path: "/dev/other" }] };
        };
        setTimeout(() => w.press("R"), 200);
        setTimeout(() => w.press("L"), 900);
        return w;
      },
      { wait: 3000 },
    );
    // The right half is one device and is restarted; the left is two builds' worth of ports and is not touched.
    expect(r.w.touches).toEqual([{ path: "/dev/fake-ttyACM-R", baud: 1200 }]);
    expect(r.states.some(([, i]) => i?.includes("more than one Glove80 left half is attached"))).toBe(true);
  });

  test("a build made before hands-free flashing is flashed without verification", async () => {
    const r = await run(GLOVE80, glove80Image(undefined), (root) => fakeWorld({ root, halves: [running("L"), running("R")] }));
    expect(r.result.state).toBe("succeeded");
    expect(r.lines.some((l) => l.includes("can't be verified from the halves' serial numbers"))).toBe(true);
    expect(r.lines.some((l) => l.includes("Verified"))).toBe(false);
  });

  test("a build ID that is not keyloom's is flashed without verification instead of failing", async () => {
    const r = await run(GLOVE80, glove80Image(KEY), (root) => fakeWorld({ root, halves: [running("L"), running("R")] }), { buildId: "bld_x" });
    expect(r.result.state).toBe("succeeded");
    expect(r.lines.some((l) => l.includes("Verified"))).toBe(false);
  });

  test("an image already flashed by another build's key is not taken as this build's", async () => {
    // The artifact carries OTHER, but the flash is of BUILD: verification is off rather than comparing against the wrong thing.
    const r = await run(GLOVE80, glove80Image("CCCCCCCCCCCC"), (root) => fakeWorld({ root, halves: [running("L"), running("R")] }));
    expect(r.lines.some((l) => l.includes("Verified"))).toBe(false);
  });
});

describe("the Corne: two halves under one volume name", () => {
  const bundle = () => zipSync({ "left.uf2": uf2Carrying(serialOf(KEY, "L", ":0123456789ABCDEF"), 0xada52840), "right.uf2": uf2Carrying(serialOf(KEY, "R", ":0123456789ABCDEF"), 0xada52840, 6) });
  const half = (letter: "L" | "R") => ({ letter, volume: "NICENANO", vendorId: 0x1d50, productId: 0x615e, serial: serialOf(OLD_KEY, letter, ":0123456789ABCDEF") });

  test("flashes one half after the other, each triggered by its own marker, and each gets its own image", async () => {
    const r = await run(CORNE, bundle(), (root) => fakeWorld({ root, halves: [half("L"), half("R")] }));
    expect(r.result).toMatchObject({ state: "succeeded" });
    expect(r.w.touches).toEqual([{ path: "/dev/fake-ttyACM-L", baud: 1200 }, { path: "/dev/fake-ttyACM-R", baud: 1200 }]);
    expect(r.w.flashed.map((f) => f.letter)).toEqual(["L", "R"]);
    expect(r.saved).toEqual([["L", 2048], ["R", 3072]]);
    expect(r.lines.at(-1)).toContain("Verified: the left half is running build");
  });

  test("a shared-drive peer with no marker cannot be ruled out as an open bootloader, so keyloom asks for the half instead of restarting it", async () => {
    const r = await run(CORNE, bundle(), (root) => fakeWorld({ root, halves: [half("L"), { letter: "R", volume: "NICENANO", vendorId: 0x1d50, productId: 0x615e }] }));
    expect(r.result.state).toBe("failed");
    // No drive appeared after the prompt, so nothing was written to either half.
    expect(r.result.error).toContain("Put the left half in bootloader mode");
    expect(r.w.touches).toEqual([]);
    expect(r.w.flashed).toEqual([]);
  });
});

describe("two boards on one desk", () => {
  const corneHalf = (letter: "L" | "R") => ({ letter, volume: "NICENANO", vendorId: 0x1d50, productId: 0x615e, path: `/dev/fake-corne-${letter}`, serial: serialOf(OLD_KEY, letter, ":0123456789ABCDEF") });
  const glove80Half = (letter: "L" | "R") => ({ ...running(letter), path: `/dev/fake-glove-${letter}` });
  const bundle = () => zipSync({ "left.uf2": uf2Carrying(serialOf(KEY, "L", ":0123456789ABCDEF"), 0xada52840), "right.uf2": uf2Carrying(serialOf(KEY, "R", ":0123456789ABCDEF"), 0xada52840) });

  test("the Corne's flash never touches a Glove80 half, though both carry keyloom's marker with the same letters", async () => {
    const r = await run(CORNE, bundle(), (root) => fakeWorld({ root, halves: [glove80Half("L"), glove80Half("R"), corneHalf("L"), corneHalf("R")] }), { foreign: true });
    expect(r.result.state).toBe("succeeded");
    expect(r.w.touches.map((t) => t.path)).toEqual(["/dev/fake-corne-L", "/dev/fake-corne-R"]);
  });

  test("without that rule the Corne would have taken the Glove80's half, which is why the rule exists", async () => {
    const r = await run(CORNE, bundle(), (root) => fakeWorld({ root, halves: [glove80Half("L"), corneHalf("L"), corneHalf("R")] }), { wait: 600 });
    // Two candidates for the left half: ambiguous, so neither is touched.
    expect(r.w.touches).toEqual([]);
    expect(r.states.some(([, i]) => i?.includes("more than one Corne left half is attached"))).toBe(true);
  });

  test("a board's own IDs are what mark its ports as another board's", () => {
    const foreign = portOfAnotherBoard("foostan/corne");
    expect(foreign({ vendorId: 0x16c0, productId: 0x27db, path: "x" })).toBe(true);
    expect(foreign({ vendorId: 0x16c0, productId: 0x27d9, path: "x" })).toBe(true);
    expect(foreign({ vendorId: 0x1d50, productId: 0x615e, path: "x" })).toBe(false);
    expect(portOfAnotherBoard("moergo/glove80")({ vendorId: 0x16c0, productId: 0x27db, path: "x" })).toBe(false);
  });
});
