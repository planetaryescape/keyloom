// The Glove80's hands-free flash end to end through the app: a build carries the module and the halves' markers, and a flash
// restarts each half over its serial port, writes the file and checks the half came back running the build. Docker, USB serial
// and the boot drives are fakes; nothing here touches a keyboard.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildAndWait, flashAndWait, getFlash } from "../../src/app/index.ts";
import { buildKey } from "../../src/firmware/zmk/handsfree.ts";
import { MODULE_FILES } from "../../src/firmware/zmk/module.ts";
import { OLD_KEY, fakeWorld, glove80Image, serialOf } from "../helpers/fake-zmk-halves.ts";
import { fakeBootloaders, zmkEnv } from "../helpers/zmk.ts";

const half = (letter: "L" | "R") => ({ letter, volume: letter === "L" ? "GLV80LHBOOT" : "GLV80RHBOOT", serial: serialOf(OLD_KEY, letter) });

describe("a Glove80 build carries keyloom's module", () => {
  test("the checkout gets the module, a Nix expression that builds with it, and one serial-number conf per half naming the build", async () => {
    const e = await zmkEnv();
    const build = await e.run(() => buildAndWait(e.app, "glove80"));
    const key = buildKey(build.id);
    for (const path of Object.keys(MODULE_FILES)) expect(await Bun.file(join(e.checkout, "keyloom-zmk", path)).text()).toBe(MODULE_FILES[path] as string);
    const nix = await Bun.file(join(e.checkout, "config", "default.nix")).text();
    expect(nix).toContain("extraModules = [ module ]");
    expect(nix).toContain("-DEXTRA_DTC_OVERLAY_FILE=");
    expect(await Bun.file(join(e.checkout, "config", "keyloom-L.conf")).text()).toContain(`CONFIG_USB_DEVICE_SN="keyloom/${key}-L:GLV80-0123456789ABCDEF"`);
    expect(await Bun.file(join(e.checkout, "config", "keyloom-R.conf")).text()).toContain(`CONFIG_USB_DEVICE_SN="keyloom/${key}-R:GLV80-0123456789ABCDEF"`);
    // The layout's own conf is not touched by the marker: both halves read it.
    expect(await Bun.file(join(e.checkout, "config", "glove80.conf")).text()).not.toContain("USB_DEVICE_SN");
    // The fake docker's firmware has no marker in it, which the build log says.
    expect(build.logTail.join("\n")).toContain("does not carry the build key");
  });

  test("keyloom generate writes the plain source and no marker: it has no build", async () => {
    const e = await zmkEnv();
    const { generateFirmware } = await import("../../src/app/index.ts");
    const r = await generateFirmware(e.app, "glove80", { out: join(e.root, "gen") });
    expect(r.files).toEqual(["glove80.keymap", "glove80.conf"]);
  });
});

describe("a Glove80 flash", () => {
  async function built(e: Awaited<ReturnType<typeof zmkEnv>>) {
    const b = await e.run(() => buildAndWait(e.app, "glove80"));
    // What a real build has in it: the halves' serial templates. The fake docker's file has none.
    await Bun.write(b.artifactPath as string, glove80Image(buildKey(b.id)));
    return b;
  }

  test("restarts both halves by itself, shows no key combo, reports the verified build and keeps the images", async () => {
    const e = await zmkEnv();
    const b = await built(e);
    const world = fakeWorld({ root: e.volumes, halves: [half("L"), half("R")] });
    const seen: Array<string | null> = [];
    const f = await flashAndWait(e.app, { buildId: b.id, volumesRoot: e.volumes, handsFree: { zmk: world.deps }, onState: (v) => seen.push(v.instruction) });
    world.stop();
    expect(f.status).toBe("succeeded");
    expect(f.note).toBe(`Verified: the right half is running build ${b.id}, and the left half is running build ${b.id}.`);
    expect(world.touches.map((t) => t.baud)).toEqual([1200, 1200]);
    expect(seen.some((i) => i?.includes("restarting the right half"))).toBe(true);
    expect(seen.some((i) => i?.includes("Magic"))).toBe(false); // the manual instruction names the Magic key
    for (const letter of ["L", "R"]) expect(Bun.file(join(e.dataDir, "firmware", "last-good", "moergo-glove80", `${letter}.uf2`)).size).toBeGreaterThan(0);
    // It reads back from the log, so a reload of the web app shows the same.
    expect((await getFlash(e.app, f.id)).note).toBe(f.note);
  });

  test("halves that don't run keyloom's firmware yet get the key combo, with the reason, and the first flash is still verified", async () => {
    const e = await zmkEnv();
    const b = await built(e);
    const world = fakeWorld({ root: e.volumes, halves: [{ letter: "L", volume: "GLV80LHBOOT" }, { letter: "R", volume: "GLV80RHBOOT" }] });
    const seen: Array<string | null> = [];
    const flashed = flashAndWait(e.app, { buildId: b.id, volumesRoot: e.volumes, bootloaderWaitMs: 5000, handsFree: { zmk: world.deps }, onState: (v) => seen.push(v.instruction) });
    setTimeout(() => world.press("R"), 200);
    setTimeout(() => world.press("L"), 900);
    const f = await flashed;
    world.stop();
    expect(f.status).toBe("succeeded");
    expect(world.touches).toEqual([]);
    expect(seen.some((i) => i?.includes("couldn't restart the right half by itself") && i.includes("Flash the right half (1 of 2)"))).toBe(true);
    expect(f.note).toContain("Verified");
  });

  test("a flash of a build without the markers asks for the key combo and flashes as before", async () => {
    const e = await zmkEnv();
    const b = await e.run(() => buildAndWait(e.app, "glove80"));
    const boot = fakeBootloaders(e.volumes, ["GLV80RHBOOT", "GLV80LHBOOT"], { mountAfterMs: [100, 700] });
    const world = fakeWorld({ root: join(e.root, "elsewhere"), halves: [] });
    const f = await flashAndWait(e.app, { buildId: b.id, volumesRoot: e.volumes, bootloaderWaitMs: 5000, handsFree: { zmk: world.deps } });
    boot.stop();
    world.stop();
    expect(f.status).toBe("succeeded");
    expect(f.note).toBeNull();
    expect(boot.written).toEqual(["GLV80RHBOOT", "GLV80LHBOOT"]);
  });
});
