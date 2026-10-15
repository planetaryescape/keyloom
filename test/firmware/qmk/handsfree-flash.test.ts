import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { qmkRevision } from "../../../src/firmware/qmk/board-config.ts";
import { bootloaderPacket, buildMarker } from "../../../src/firmware/qmk/handsfree.ts";
import { handsFreeHooks, keyboardTarget, readRunningFirmware, rebootToBootloader, verifyBuild } from "../../../src/firmware/qmk/handsfree-flash.ts";
import { LogSink } from "../../../src/firmware/toolchain/run.ts";
import { moonlander } from "../../helpers/board.ts";
import { MOONLANDER_REVA, dfuBootloader, fakeKeyboard, rawHidOf, runningKeyboard } from "../../helpers/fake-hid.ts";
import { tempDir } from "../../helpers/tmp.ts";

const web = await moonlander();
const BUILD = "bld_01JABCDEFGHJKMNPQRSTVWXYZ0";
const MARKER = buildMarker(BUILD);
const OLD = "keyloom/AAAAAAAAAAAA";
const ORYX = "QxKPz/zLQ3Md";

describe("readRunningFirmware", () => {
  test("tells keyloom's firmware from Oryx's and from no keyboard", async () => {
    expect(await readRunningFirmware(fakeKeyboard({ usb: () => [runningKeyboard(OLD)] }).deps, MOONLANDER_REVA)).toEqual({ state: "keyloom", serial: OLD });
    expect(await readRunningFirmware(fakeKeyboard({ usb: () => [runningKeyboard(ORYX)] }).deps, MOONLANDER_REVA)).toEqual({ state: "other", serial: ORYX });
    expect(await readRunningFirmware(fakeKeyboard({ usb: () => [runningKeyboard()] }).deps, MOONLANDER_REVA)).toEqual({ state: "other", serial: undefined });
    expect(await readRunningFirmware(fakeKeyboard({ usb: () => [] }).deps, MOONLANDER_REVA)).toEqual({ state: "absent" });
  });

  test("a device with the right product ID from another vendor is not the keyboard", async () => {
    const lookalike = { ...runningKeyboard(OLD), vendorId: "0x05ac" };
    expect((await readRunningFirmware(fakeKeyboard({ usb: () => [lookalike] }).deps, MOONLANDER_REVA)).state).toBe("absent");
  });
});

describe("rebootToBootloader", () => {
  const lines: string[] = [];
  const say = (l: string) => lines.push(l);

  test("sends the bootloader packet to the raw HID interface and succeeds when the bootloader appears", async () => {
    const k = fakeKeyboard({ usb: (n) => (n < 2 ? [runningKeyboard(OLD)] : [dfuBootloader()]), hid: [rawHidOf(OLD)] });
    expect(await rebootToBootloader(k.deps, MOONLANDER_REVA, say)).toEqual({ ok: true });
    expect(k.writes).toHaveLength(1);
    expect([...(k.writes[0] as Uint8Array)]).toEqual([...bootloaderPacket()]);
  });

  test("a keyboard that left USB before the next poll counts as restarted: zapp may already be writing", async () => {
    const k = fakeKeyboard({ usb: (n) => (n < 1 ? [runningKeyboard(OLD)] : []), hid: [rawHidOf(OLD)] });
    expect(await rebootToBootloader(k.deps, MOONLANDER_REVA, say)).toEqual({ ok: true });
  });

  test("a write error is not fatal when the keyboard restarted anyway", async () => {
    const k = fakeKeyboard({
      usb: (n) => (n < 2 ? [runningKeyboard(OLD)] : [dfuBootloader()]), hid: [rawHidOf(OLD)],
      onWrite: () => {
        throw new Error("IOReturn 0xe00002ed");
      },
    });
    expect(await rebootToBootloader(k.deps, MOONLANDER_REVA, say)).toEqual({ ok: true });
  });

  test("a write error and a keyboard that stays put is a failure that names the error, quickly", async () => {
    const k = fakeKeyboard({
      usb: () => [runningKeyboard(OLD)], hid: [rawHidOf(OLD)],
      onWrite: () => {
        throw new Error("macOS refused to open the keyboard's raw HID interface");
      },
    });
    const started = Date.now();
    const r = await rebootToBootloader(k.deps, MOONLANDER_REVA, say, 60_000);
    expect(r).toEqual({ ok: false, reason: "macOS refused to open the keyboard's raw HID interface" });
    expect(Date.now() - started).toBeLessThan(8000);
  });

  test("a packet that was sent but changed nothing is reported as a timeout", async () => {
    const k = fakeKeyboard({ usb: () => [runningKeyboard(OLD)], hid: [rawHidOf(OLD)] });
    const r = await rebootToBootloader(k.deps, MOONLANDER_REVA, say, 100);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain("didn't enter its bootloader");
  });

  test("firmware keyloom didn't build is never sent anything", async () => {
    const k = fakeKeyboard({ usb: () => [runningKeyboard(ORYX)], hid: [rawHidOf(ORYX)] });
    const r = await rebootToBootloader(k.deps, MOONLANDER_REVA, say, 100);
    expect(r).toMatchObject({ ok: false });
    expect((r as { reason: string }).reason).toContain(ORYX);
    expect(k.writes).toEqual([]);
  });

  test("no keyboard, or no raw HID interface, sends nothing", async () => {
    const none = fakeKeyboard({ usb: () => [], hid: [rawHidOf()] });
    expect(await rebootToBootloader(none.deps, MOONLANDER_REVA, say, 50)).toMatchObject({ ok: false, reason: "no Moonlander is attached" });
    const noHid = fakeKeyboard({ usb: () => [runningKeyboard(OLD)], hid: [] });
    expect((await rebootToBootloader(noHid.deps, MOONLANDER_REVA, say, 50) as { reason: string }).reason).toContain("raw HID interface wasn't found");
    expect(none.writes.concat(noHid.writes)).toEqual([]);
  });

  test("a raw HID lookup that misses once is retried, and a miss every time says what it saw", async () => {
    const k = fakeKeyboard({ usb: () => [runningKeyboard(OLD)] });
    let lists = 0;
    const flaky = { list: async () => (++lists === 1 ? [] : [rawHidOf(OLD)]), write: async (_t: unknown, r: Uint8Array) => void k.writes.push(new Uint8Array(r)) };
    await rebootToBootloader({ ...k.deps, hid: async () => flaky }, MOONLANDER_REVA, say, 50);
    expect(lists).toBe(2);
    expect(k.writes).toHaveLength(1);

    const never = fakeKeyboard({ usb: () => [runningKeyboard(OLD)], hid: [rawHidOf("keyloom/BBBBBBBBBBBB")] });
    const r = (await rebootToBootloader(never.deps, MOONLANDER_REVA, say, 50)) as { reason: string };
    expect(r.reason).toContain(`USB says ${OLD}; raw HID showed only 0x1969 serial keyloom/BBBBBBBBBBBB`);
    expect(never.writes).toEqual([]);
  });

  test("with two keyboards attached the packet goes to the one whose serial matches, never the other", async () => {
    const other = { vendorId: 0x3297, productId: 0x1969, serial: "keyloom/BBBBBBBBBBBB", handle: "fake-2" };
    const writes: string[] = [];
    const k = fakeKeyboard({ usb: (n) => (n < 1 ? [runningKeyboard(OLD)] : []), hid: [other, rawHidOf(OLD)] });
    const original = await k.deps.hid();
    k.deps.hid = async () => ({ list: () => original.list(), write: async (t, r) => { writes.push(t.handle); await original.write(t, r); } });
    await rebootToBootloader(k.deps, MOONLANDER_REVA, say);
    expect(writes).toEqual(["fake-1"]);
  });

  test("a HID transport that can't be created (an unsupported OS, a refused test) is a reason, not a crash", async () => {
    const k = fakeKeyboard({ usb: () => [runningKeyboard(OLD)] });
    k.deps.hid = async () => {
      throw new Error("keyloom can't talk to a keyboard's raw HID interface on win32");
    };
    expect(await rebootToBootloader(k.deps, MOONLANDER_REVA, say, 50)).toMatchObject({ ok: false, reason: expect.stringContaining("win32") });
  });
});

describe("verifyBuild", () => {
  const say = () => undefined;

  test("passes when the keyboard comes back carrying the new build's marker", async () => {
    // Still in the bootloader for two listings, then back.
    const k = fakeKeyboard({ usb: (n) => (n < 2 ? [dfuBootloader()] : [runningKeyboard(MARKER)]) });
    expect(await verifyBuild(k.deps, MOONLANDER_REVA, BUILD, say, 2000)).toEqual({ ok: true, message: `Verified: the keyboard is running build ${BUILD}.` });
  });

  test("fails at once when it comes back running something else, naming both", async () => {
    const k = fakeKeyboard({ usb: () => [runningKeyboard(OLD)] });
    const r = await verifyBuild(k.deps, MOONLANDER_REVA, BUILD, say, 2000);
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain(OLD);
    expect((r as { error: string }).error).toContain(MARKER);
    expect(k.listings()).toBe(1);
  });

  test("fails with advice when the keyboard never comes back", async () => {
    const k = fakeKeyboard({ usb: () => [dfuBootloader()] });
    const r = await verifyBuild(k.deps, MOONLANDER_REVA, BUILD, say, 100);
    expect((r as { error: string }).error).toContain("didn't come back");
    expect((r as { error: string }).error).toContain("keyloom doctor");
  });

  test("Oryx's serial after the flash is a failure too: the old firmware is still there", async () => {
    const k = fakeKeyboard({ usb: () => [runningKeyboard(ORYX)] });
    expect((await verifyBuild(k.deps, MOONLANDER_REVA, BUILD, say, 100)).ok).toBe(false);
  });
});

describe("handsFreeHooks", () => {
  const dir = tempDir();
  const log = new LogSink(join(dir, "hooks.log"));
  const rev = qmkRevision(web.definition, "reva");
  const artifactWith = (marker: string) => new TextEncoder().encode(`firmware\0${marker}\0more`);
  const hooks = (usb: ReturnType<typeof fakeKeyboard>, artifact: Uint8Array) => handsFreeHooks({ deps: usb.deps, board: web.definition, rev, artifact, buildId: BUILD, log });

  test("offers the bootloader command only when the running firmware is keyloom's, and verification only for a keyloom build", async () => {
    const mine = await hooks(fakeKeyboard({ usb: () => [runningKeyboard(OLD)] }), artifactWith(MARKER));
    expect(mine.enterBootloader).toBeFunction();
    expect(mine.verify).toBeFunction();
    const oryx = await hooks(fakeKeyboard({ usb: () => [runningKeyboard(ORYX)] }), artifactWith(MARKER));
    expect(oryx.enterBootloader).toBeUndefined();
    expect(oryx.verify).toBeFunction();
    const oldBuild = await hooks(fakeKeyboard({ usb: () => [runningKeyboard(OLD)] }), artifactWith("QxKPz/zLQ3Md"));
    expect(oldBuild.enterBootloader).toBeFunction();
    expect(oldBuild.verify).toBeUndefined();
  });

  test("a firmware file carrying another build's marker is not verified as this one", async () => {
    const h = await hooks(fakeKeyboard({ usb: () => [] }), artifactWith(OLD));
    expect(h.verify).toBeUndefined();
  });

  test("a USB listing that throws leaves the flash as it was: no hooks that could misfire", async () => {
    const k = fakeKeyboard({ usb: () => [] });
    k.deps.usb = async () => {
      throw new Error("system_profiler hung");
    };
    expect((await hooks(k, new Uint8Array())).enterBootloader).toBeUndefined();
  });

  test("a board that isn't ZSA's gets nothing", async () => {
    const other = { ...web.definition, vendor: "Other" };
    expect(keyboardTarget(other, rev)).toBeUndefined();
    expect(await handsFreeHooks({ deps: fakeKeyboard({ usb: () => [] }).deps, board: other, rev, artifact: new Uint8Array(), buildId: BUILD, log })).toEqual({});
  });
});

test("the Moonlander's revisions are recognised by their running product ID and flashed through their bootloaders", () => {
  const a = keyboardTarget(web.definition, qmkRevision(web.definition, "reva"));
  const b = keyboardTarget(web.definition, qmkRevision(web.definition, "revb"));
  expect(a).toMatchObject({ productId: "0x1969", bootloader: "0483:df11" });
  expect(b).toMatchObject({ productId: "0x1972", bootloader: "3297:2003" });
});
