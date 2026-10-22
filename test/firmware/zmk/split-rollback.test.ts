import { expect, test } from "bun:test";
import { zipSync } from "fflate";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadBoardDir } from "../../../src/boards/load.ts";
import { LogSink } from "../../../src/firmware/toolchain/run.ts";
import { zmkRevision } from "../../../src/firmware/zmk/board-config.ts";
import { flashUf2Drives } from "../../../src/firmware/zmk/flash.ts";
import { zmkHandsFreeHooks } from "../../../src/firmware/zmk/handsfree-flash.ts";
import { type HalfLetter, keyInFirmware } from "../../../src/firmware/zmk/handsfree.ts";
import { volumeFinderAt } from "../../../src/firmware/zmk/volumes.ts";
import { type FakeWorld, OLD_KEY, fakeWorld, glove80Image, serialOf, uf2Carrying } from "../../helpers/fake-zmk-halves.ts";
import { tempDir } from "../../helpers/tmp.ts";

const BUILD = "bld_01M509Z0DJYBG04NY1MKBCK6TY";
const KEY = "4NY1MKBCK6TY";
const board = await loadBoardDir(`${import.meta.dir}/../../../boards/moergo/glove80`);
const half = (letter: HalfLetter) => ({ letter, volume: letter === "L" ? "GLV80LHBOOT" : "GLV80RHBOOT", serial: serialOf(OLD_KEY, letter) });

type Options = {
  world?: Partial<Omit<Parameters<typeof fakeWorld>[0], "root">>;
  board?: typeof board;
  artifact?: Uint8Array;
  missing?: HalfLetter[];
  previous?: (letter: HalfLetter) => Uint8Array | null;
  write?: (path: string, image: Uint8Array) => Promise<void>;
  instruction?: (w: FakeWorld, instruction: string) => void;
};
async function flash(opts: Options = {}) {
  const selected = opts.board ?? board;
  const recipe = zmkRevision(selected.definition).flash;
  const dir = tempDir();
  const root = join(dir, "Volumes");
  mkdirSync(root);
  const artifact = opts.artifact ?? glove80Image(KEY);
  const artifactPath = join(dir, opts.board ? "build.zip" : "build.uf2");
  await Bun.write(artifactPath, artifact);
  const w = fakeWorld({ root, halves: [half("L"), half("R")], ...opts.world });
  const saved: Array<{ half: HalfLetter; key: string | undefined; flashed: number }> = [];
  const states: Array<[string, string | null]> = [];
  const lines: string[] = [];
  const findVolume = volumeFinderAt(root);
  const hooks = zmkHandsFreeHooks({
    deps: w.deps, board: selected.definition, handsFree: recipe.handsFree!, steps: recipe.steps,
    artifact, buildId: BUILD, findVolume, log: (l) => lines.push(l),
    loadLastGood: async (letter) => opts.previous ? opts.previous(letter) : opts.missing?.includes(letter) ? null : glove80Image(OLD_KEY),
    saveLastGood: async (letter, image) => { saved.push({ half: letter, key: keyInFirmware(image), flashed: w.flashed.length }); },
  });
  try {
    const result = await flashUf2Drives({
      artifactPath, steps: recipe.steps, hooks, findVolume, log: new LogSink(join(dir, "flash.log")),
      onLine: (l) => lines.push(l),
      onState: (s, i) => { states.push([s, i]); if (i) opts.instruction?.(w, i); },
      bootloaderWaitMs: 100, pollMs: 5, unmountWaitMs: 200, goneWaitMs: 20, writeRetryMs: 0,
      ...(opts.write ? { writeImage: opts.write } : {}),
    });
    return { result, saved, states, lines, w };
  } finally { w.stop(); }
}
const restartFails = { touchError: (path: string) => path.endsWith("-L") ? "injected left restart failure" : undefined };
const expectOld = (r: Awaited<ReturnType<typeof flash>>) => {
  expect(r.result.state).toBe("failed");
  expect(r.result.error).toContain("The keyboard is back on the previous build");
  expect(r.result.error).toContain(`right half is running build ${OLD_KEY}`);
  expect(r.result.error).toContain(`left half is running build ${OLD_KEY}`);
  expect(r.w.halves.map((h) => h.serial)).toEqual([serialOf(OLD_KEY, "L"), serialOf(OLD_KEY, "R")]);
  expect(r.saved).toEqual([]);
};

test("second restart fails: the first half is rolled back and verified on the image's old key", async () => {
  const r = await flash({ world: restartFails });
  expectOld(r);
  expect(r.w.flashed).toEqual([{ letter: "R", key: KEY }, { letter: "R", key: OLD_KEY }]);
  expect(r.lines.join("\n")).toContain("Rolling back the right half");
});

test("second copy fails while mounted: both halves are restored, accepting the already open bootloader", async () => {
  const r = await flash({
    write: async (path, image) => {
      if (path.includes("LHBOOT") && keyInFirmware(image) === KEY) throw new Error("injected copy failure");
      await writeFile(path, image);
    },
  });
  expectOld(r);
  expect(r.w.flashed).toEqual([{ letter: "R", key: KEY }, { letter: "R", key: OLD_KEY }, { letter: "L", key: OLD_KEY }]);
  expect(r.states.some(([s, i]) => s === "waiting_for_bootloader" && i?.includes("Magic + E"))).toBe(true);
});

test("second half never returns: restore the first, request the second bootloader, then restore and verify it", async () => {
  const r = await flash({
    world: { after: (h, key) => h.letter === "L" && key === KEY ? undefined : serialOf(key!, h.letter) },
    write: async (path, image) => {
      await writeFile(path, image);
      if (path.includes("LHBOOT") && keyInFirmware(image) === KEY) {
        while (await Bun.file(path).exists()) await Bun.sleep(5);
        throw Object.assign(new Error("injected ENXIO mid-copy"), { code: "ENXIO" });
      }
    },
    instruction: (w, i) => { if (i.startsWith("Restore the left half")) w.press("L"); },
  });
  expectOld(r);
  expect(r.w.flashed).toEqual([{ letter: "R", key: KEY }, { letter: "L", key: KEY }, { letter: "R", key: OLD_KEY }, { letter: "L", key: OLD_KEY }]);
  expect(r.states.some(([s, i]) => s === "waiting_for_bootloader" && i?.startsWith("Restore the left half") && i.includes("Magic + E"))).toBe(true);
  expect(r.lines.join("\n")).toContain("injected ENXIO mid-copy");
});

test("second half returns on its old key: only the first needs a rollback", async () => {
  const r = await flash({ world: { after: (h, key) => h.letter === "L" ? h.serial : serialOf(key!, h.letter) } });
  expectOld(r);
  expect(r.w.flashed).toEqual([{ letter: "R", key: KEY }, { letter: "L", key: KEY }, { letter: "R", key: OLD_KEY }]);
});

test("no last-good image: nothing is written for rollback and the failure names both halves and the flash-again remedy", async () => {
  const r = await flash({ world: restartFails, missing: ["R", "L"] });
  expect(r.result.state).toBe("failed");
  expect(r.w.flashed).toEqual([{ letter: "R", key: KEY }]);
  expect(r.result.error).toContain("no verified last-good image for the right half");
  expect(r.result.error).toContain(`right half is running build ${KEY}`);
  expect(r.result.error).toContain(`left half is running build ${OLD_KEY}`);
  expect(r.result.error).toContain("To finish the new build, put the left half in its bootloader and flash again");
  expect(r.saved).toEqual([]);
});

test("rollback copy fails: stop after one attempt and report the actual half states", async () => {
  let rollbackWrites = 0;
  const r = await flash({
    world: restartFails,
    write: async (path, image) => {
      if (keyInFirmware(image) === OLD_KEY) { rollbackWrites++; throw new Error("injected rollback copy failure"); }
      await writeFile(path, image);
    },
  });
  expect(r.result.state).toBe("failed");
  expect(r.result.error).toContain("Rollback of the right half failed");
  expect(r.result.error).toContain("injected rollback copy failure");
  expect(r.result.error).toContain("right half is absent or in its bootloader");
  expect(r.result.error).toContain(`left half is running build ${OLD_KEY}`);
  expect(rollbackWrites).toBe(1);
  expect(r.saved).toEqual([]);
});

test("last-good is promoted only when both halves verify; the success messages stay the same", async () => {
  const r = await flash();
  expect(r.result.state).toBe("succeeded");
  expect(r.result.handsFree).toBe(true);
  expect(r.saved).toEqual([{ half: "R", key: KEY, flashed: 2 }, { half: "L", key: KEY, flashed: 2 }]);
  expect(r.lines.at(-1)).toBe(`keyloom: Verified: the right half is running build ${BUILD}, and the left half is running build ${BUILD}.`);
});

test("a missing saved image for the absent half still restores the verified half and reports incomplete recovery", async () => {
  const r = await flash({ missing: ["L"], world: { after: (h, key) => h.letter === "L" && key === KEY ? undefined : serialOf(key!, h.letter) } });
  expect(r.result.error).toContain("Rollback is incomplete: no last-good image");
  expect(r.result.error).toContain(`right half is running build ${OLD_KEY}`);
  expect(r.result.error).toContain("left half is absent or in its bootloader");
  expect(r.w.flashed.at(-1)).toEqual({ letter: "R", key: OLD_KEY });
  expect(r.saved).toEqual([]);
});

test("a shared drive already open for the failed half is never mistaken for the rollback target", async () => {
  const corne = await loadBoardDir(`${import.meta.dir}/../../../boards/foostan/corne`);
  const artifact = zipSync({ "left.uf2": uf2Carrying(serialOf(KEY, "L"), 0xada52840), "right.uf2": uf2Carrying(serialOf(KEY, "R"), 0xada52840) });
  let writes = 0;
  const r = await flash({ board: corne, artifact,
    previous: (letter) => uf2Carrying(serialOf(OLD_KEY, letter), 0xada52840),
    world: { halves: ["L", "R"].map((letter) => ({ ...half(letter as HalfLetter), volume: "NICENANO", vendorId: 0x1d50, productId: 0x615e })) },
    write: async (path, image) => { if (++writes === 2) throw new Error("injected copy failure"); await writeFile(path, image); },
  });
  expect(r.result.error).toContain("NICENANO is already mounted and could belong to either half");
  expect(r.result.error).toContain(`left half is running build ${KEY}`);
  expect(r.result.error).toContain("right half is absent or in its bootloader");
  expect(writes).toBe(2);
  expect(r.saved).toEqual([]);
});

test("a rollback that cannot verify stops after one restore and names the half's actual build", async () => {
  const r = await flash({ world: { ...restartFails, after: (h, key) => key === OLD_KEY ? h.serial : serialOf(key!, h.letter) } });
  expect(r.result.error).toContain("Rollback of the right half failed");
  expect(r.result.error).toContain(`right half is running build ${KEY}`);
  expect(r.w.flashed).toEqual([{ letter: "R", key: KEY }, { letter: "R", key: OLD_KEY }]);
  expect(r.saved).toEqual([]);
});

test("an unknown build on the failed half is restored through its manual bootloader", async () => {
  const r = await flash({
    world: { after: (h, key) => serialOf(h.letter === "L" && key === KEY ? "BBBBBBBBBBBB" : key!, h.letter) },
    instruction: (w, i) => { if (i.startsWith("Restore the left half")) w.press("L"); },
  });
  expectOld(r);
  expect(r.w.flashed.at(-1)).toEqual({ letter: "L", key: OLD_KEY });
});

test("the recovery bootloader wait ends with the recovered half and the missing half named", async () => {
  const r = await flash({ world: { after: (h, key) => h.letter === "L" && key === KEY ? undefined : serialOf(key!, h.letter) } });
  expect(r.result.error).toContain("Rollback of the left half failed");
  expect(r.result.error).toContain(`right half is running build ${OLD_KEY}`);
  expect(r.result.error).toContain("left half is absent or in its bootloader");
  expect(r.w.flashed.at(-1)).toEqual({ letter: "R", key: OLD_KEY });
});

test("a saved image targeting the bootloader is refused before any recovery write", async () => {
  const r = await flash({ world: restartFails, previous: () => uf2Carrying(serialOf(OLD_KEY, "R"), 0xd663823c) });
  expect(r.result.error).toContain("refusing to overwrite bootloader");
  expect(r.w.flashed).toEqual([{ letter: "R", key: KEY }]);
  expect(r.saved).toEqual([]);
});
