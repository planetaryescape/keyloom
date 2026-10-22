// `keyloom flash` on a Glove80 and the ZMK lines of `keyloom doctor`, against a fake serial bus and fake boot drives.
import { describe, expect, test } from "bun:test";
import { runCli } from "../../src/cli/main.ts";
import type { Io } from "../../src/cli/output.ts";
import { buildKey } from "../../src/firmware/zmk/handsfree.ts";
import type { HandsFreeOverrides } from "../../src/app/index.ts";
import { OLD_KEY, fakeWorld, glove80Image, serialOf } from "../helpers/fake-zmk-halves.ts";
import { zmkEnv } from "../helpers/zmk.ts";

type Result = { code: number; out: string; err: string };
async function cli(args: string[], handsFree?: HandsFreeOverrides): Promise<Result> {
  let out = "";
  let err = "";
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: false };
  return { code: await runCli(args, io, {}, handsFree), out, err };
}
const json = (r: Result) => JSON.parse(r.out);
const half = (letter: "L" | "R") => ({ letter, volume: letter === "L" ? "GLV80LHBOOT" : "GLV80RHBOOT", serial: serialOf(OLD_KEY, letter) });

describe("keyloom flash on a Glove80 running keyloom's firmware", () => {
  test("restarts each half, flashes it and says what it verified; the key combo is never asked for", async () => {
    const e = await zmkEnv();
    await e.run(async () => {
      const b = json(await cli(["build", "glove80", "--data-dir", e.dataDir, "--format", "json"]));
      await Bun.write(b.artifact_path, glove80Image(buildKey(b.build_id)));
      const world = fakeWorld({ root: e.volumes, halves: [half("L"), half("R")] });
      const r = await cli(["flash", "--layout", "glove80", "--volumes-root", e.volumes, "--data-dir", e.dataDir, "--format", "json"], { zmk: world.deps });
      world.stop();
      expect(r.code).toBe(0);
      expect(json(r)).toMatchObject({ status: "succeeded", build_id: b.build_id });
      expect(json(r).note).toBe(`Verified: the right half is running build ${b.build_id}, and the left half is running build ${b.build_id}.`);
      expect(world.touches.map((t) => [t.path.slice(-1), t.baud])).toEqual([["R", 1200], ["L", 1200]]);
      expect(r.err).toContain("restarting the right half into its bootloader");
      expect(r.err).not.toContain("Magic");
    });
  });

  test("falls back to the key combo with the reason when no half has a serial port", async () => {
    const e = await zmkEnv();
    await e.run(async () => {
      const b = json(await cli(["build", "glove80", "--data-dir", e.dataDir, "--format", "json"]));
      await Bun.write(b.artifact_path, glove80Image(buildKey(b.build_id)));
      const world = fakeWorld({ root: e.volumes, halves: [{ letter: "L", volume: "GLV80LHBOOT" }, { letter: "R", volume: "GLV80RHBOOT" }] });
      setTimeout(() => world.press("R"), 300);
      setTimeout(() => world.press("L"), 1200);
      const r = await cli(["flash", "--layout", "glove80", "--volumes-root", e.volumes, "--wait", "1", "--data-dir", e.dataDir, "--format", "json"], { zmk: world.deps });
      world.stop();
      expect(r.code).toBe(0);
      expect(r.err).toContain("couldn't restart the right half by itself: no keyloom serial port was found for it");
      expect(r.err).toContain("hold I + PgDn");
    });
  });
});

describe("keyloom doctor, ZMK halves", () => {
  test("shows each half's state: its build, firmware without the module, or nothing", async () => {
    const e = await zmkEnv();
    await e.run(async () => {
      const world = fakeWorld({ root: e.volumes, halves: [half("L"), { letter: "R", volume: "GLV80RHBOOT" }] });
      // The right half runs older firmware: USB shows it by product ID, but it has no serial port.
      const usb = async () => [{ productId: "0x27d9", vendorId: "0x16c0", name: "Glove80 Right", maker: "MoErgo", serial: "moergo.com:GLV80-58291CCA4B6E75B0" }];
      const r = json(await cli(["doctor", "--data-dir", e.dataDir], { usb: async () => [], zmk: { ...world.deps, usb } }));
      world.stop();
      const left = r.checks.find((c: { name: string }) => c.name === "keyboard moergo/glove80 left half");
      const right = r.checks.find((c: { name: string }) => c.name === "keyboard moergo/glove80 right half");
      expect(left.detail).toContain(`running keyloom build ${OLD_KEY}`);
      expect(left.detail).toContain("needs no keypress");
      expect(right.detail).toContain("without keyloom's module");
      expect(right.detail).toContain("moergo.com:GLV80-58291CCA4B6E75B0");
      expect(r.checks.some((c: { name: string }) => c.name.includes("corne"))).toBe(false);
    });
  });

  test("with nothing attached it says so once", async () => {
    const e = await zmkEnv();
    await e.run(async () => {
      const world = fakeWorld({ root: e.volumes, halves: [] });
      const r = json(await cli(["doctor", "--data-dir", e.dataDir], { usb: async () => [], zmk: world.deps }));
      world.stop();
      expect(r.checks.find((c: { name: string }) => c.name === "keyboard")).toMatchObject({ ok: true, detail: "no keyboard keyloom can flash is attached" });
    });
  });
});

test("reboot-only requests one ZMK half through 1200 or the existing 1201 relay without a UF2 probe", async () => {
  const touches: Array<[string, number]> = [];
  const port = { vendorId: 0x16c0, productId: 0x27db, serial: serialOf(OLD_KEY, "L"), path: "synthetic-left" };
  const handsFree: HandsFreeOverrides = { zmk: { serial: async () => ({ list: async () => [port], touch: async (path, baud) => { touches.push([path, baud]); } }), usb: async () => { throw new Error("no USB or volume discovery permitted"); } } };
  for (const half of ["left", "right"]) {
    const result = await cli(["flash", "--reboot-only", "--board", "moergo/glove80", "--half", half], handsFree);
    expect(result.code).toBe(0);
    expect(json(result).transport_only).toBe(true);
  }
  expect(touches).toEqual([["synthetic-left", 1200], ["synthetic-left", 1201]]);
  const missing = await cli(["flash", "--reboot-only", "--board", "moergo/glove80"], handsFree);
  expect(missing.code).toBe(2);
  expect(missing.err).toContain("choose --half");
  expect(touches).toHaveLength(2);
});
