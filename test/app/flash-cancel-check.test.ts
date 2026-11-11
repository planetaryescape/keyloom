// Cancel while waiting for the bootloader, Check the keyboard again, and the Input Monitoring code (D-501), through the app with
// a fake zapp, a fake USB bus and a fake raw HID. Nothing here can reach a real keyboard.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { FlashNotCancellableError, buildAndWait, cancelFlash, checkFlashAgain, drainManualFlashTasks, getFlash, startFlash } from "../../src/app/index.ts";
import type { FlashView } from "../../src/app/index.ts";
import type { KeyboardReading } from "../../src/app/sync-keyboard.ts";
import { HidError } from "../../src/firmware/toolchain/hid.ts";
import { buildKey } from "../../src/firmware/zmk/handsfree.ts";
import { createFlash, finishFlash, newFlashId } from "../../src/persistence/builds.ts";
import { dfuBootloader, fakeKeyboard, rawHidOf, runningKeyboard } from "../helpers/fake-hid.ts";
import { toolchainEnv } from "../helpers/toolchain-env.ts";

const OLD = "keyloom/AAAAAAAAAAAA";
const ORYX = "QxKPz/zLQ3Md";

// Like the real zapp, it writes only once the keyboard is in its bootloader (a file here), the write takes a moment, and it prints
// nothing between "Firmware loaded" and exiting: BK's three real hands-free flashes (2026-10-22) logged exactly that (D-506).
const ZAPP = 'echo "Firmware loaded: STM32 DFU (316 bytes)"; while [ ! -f "$BOOTLOADER_FLAG" ]; do sleep 0.05; done; sleep 1.5; echo ran >> "$ZAPP_CALLS"; exit 0';

async function until(read: () => Promise<FlashView>, ok: (f: FlashView) => boolean, ms = 10_000): Promise<FlashView> {
  const by = Date.now() + ms;
  for (;;) {
    const f = await read();
    if (ok(f)) return f;
    if (Date.now() > by) throw new Error(`flash never reached the expected state; last: ${f.status} ${f.instruction}`);
    await Bun.sleep(25);
  }
}

async function built() {
  const e = await toolchainEnv({ zapp: ZAPP });
  const flag = join(e.root, "in-bootloader");
  const build = await e.run(() => buildAndWait(e.app, "synchronized", { boardRevision: "reva" }));
  return { e, flag, build, run: <T>(fn: () => Promise<T>) => e.run(fn, { BOOTLOADER_FLAG: flag }) };
}

describe("Shutting down with a flash still waiting", () => {
  // The desktop app kills a server that takes over 30 s to stop, which would leave Zapp with no parent, waiting to flash.
  test("cancels a flash still waiting for a keypress, so the shutdown ends at once and Zapp never writes", async () => {
    const s = await built();
    const keyboard = fakeKeyboard({ usb: () => [runningKeyboard(ORYX)], hid: [] });
    await s.run(async () => {
      const started = await startFlash(s.e.app, { buildId: s.build.id, handsFree: keyboard.deps });
      await until(() => getFlash(s.e.app, started.id), (f) => f.instruction?.includes("reset button") === true);
      const drained = await Promise.race([drainManualFlashTasks(s.e.app).then(() => "drained"), Bun.sleep(8000).then(() => "still waiting")]);
      expect(drained).toBe("drained");
      const done = await getFlash(s.e.app, started.id);
      expect(done).toMatchObject({ status: "failed", errorCode: "cancelled" });
      expect(existsSync(s.e.vars.ZAPP_CALLS)).toBe(false);
    });
  }, 30_000);
});

describe("Cancel while waiting for the bootloader", () => {
  test("stops a flash that is waiting for a keypress, says it was cancelled as a code, and never runs the write", async () => {
    const s = await built();
    const keyboard = fakeKeyboard({ usb: () => [runningKeyboard(ORYX)], hid: [] });
    await s.run(async () => {
      const started = await startFlash(s.e.app, { buildId: s.build.id, handsFree: keyboard.deps });
      const waiting = await until(() => getFlash(s.e.app, started.id), (f) => f.instruction?.includes("reset button") === true);
      expect(waiting).toMatchObject({ status: "waiting_for_bootloader", cancellable: true });
      const done = await cancelFlash(s.e.app, started.id);
      expect(done).toMatchObject({ status: "failed", errorCode: "cancelled", cancellable: false });
      expect(done.error).toContain("Nothing was flashed");
      expect(existsSync(s.e.vars.ZAPP_CALLS)).toBe(false);
    });
  });

  test("is refused once the write has begun, and the flash finishes", async () => {
    const s = await built();
    let wrote = false;
    let since = 0;
    const keyboard = fakeKeyboard({
      hid: [rawHidOf(OLD)],
      usb: () => {
        if (!wrote) return [runningKeyboard(OLD)];
        since++;
        return since <= 2 ? [dfuBootloader()] : [runningKeyboard(`keyloom/${buildKey(s.build.id)}`)];
      },
      onWrite: () => {
        wrote = true;
        void Bun.write(s.flag, "");
      },
    });
    await s.run(async () => {
      const started = await startFlash(s.e.app, { buildId: s.build.id, handsFree: keyboard.deps });
      const writing = await until(() => getFlash(s.e.app, started.id), (f) => f.status === "writing");
      expect(writing.cancellable).toBe(false);
      const refused = await cancelFlash(s.e.app, started.id).catch((err: unknown) => err);
      expect(refused).toBeInstanceOf(FlashNotCancellableError);
      expect((refused as FlashNotCancellableError).why).toBe("writing");
      const done = await until(() => getFlash(s.e.app, started.id), (f) => f.status === "succeeded" || f.status === "failed", 20_000);
      expect(done.status).toBe("succeeded");
      expect(existsSync(s.e.vars.ZAPP_CALLS)).toBe(true);
    });
  }, 30_000);

  // The person pressed reset: the bootloader is on USB and Zapp writes at once, saying nothing. The USB fake follows the file the
  // fake zapp waits for, and shows the new build once zapp has written it.
  function pressedReset(s: Awaited<ReturnType<typeof built>>, opts: { pollMs?: number } = {}) {
    let pressed = false;
    const keyboard = fakeKeyboard({
      hid: [],
      ...(opts.pollMs === undefined ? {} : { pollMs: opts.pollMs }),
      usb: () => (!pressed ? [runningKeyboard(ORYX)] : existsSync(s.e.vars.ZAPP_CALLS) ? [runningKeyboard(`keyloom/${buildKey(s.build.id)}`)] : [dfuBootloader()]),
    });
    return { keyboard, press: async () => { pressed = true; await Bun.write(s.flag, ""); } };
  }

  test("after a manual reset the flash says it is writing as soon as the bootloader appears, and Cancel is refused", async () => {
    const s = await built();
    const { keyboard, press } = pressedReset(s);
    await s.run(async () => {
      const started = await startFlash(s.e.app, { buildId: s.build.id, handsFree: keyboard.deps });
      await until(() => getFlash(s.e.app, started.id), (f) => f.instruction?.includes("reset button") === true);
      await press();
      const writing = await until(() => getFlash(s.e.app, started.id), (f) => f.status === "writing", 1_000);
      expect(writing.cancellable).toBe(false);
      const refused = await cancelFlash(s.e.app, started.id).catch((err: unknown) => err);
      expect((refused as FlashNotCancellableError).why).toBe("writing");
      const done = await until(() => getFlash(s.e.app, started.id), (f) => f.status === "succeeded" || f.status === "failed", 20_000);
      expect(done.status).toBe("succeeded");
      expect(existsSync(s.e.vars.ZAPP_CALLS)).toBe(true);
    });
  }, 30_000);

  test("a Cancel that comes before keyloom has seen the bootloader is still refused once it is there", async () => {
    const s = await built();
    // One look at USB when zapp has loaded the file, then none for a minute: only the cancel itself can see the reset.
    const { keyboard, press } = pressedReset(s, { pollMs: 60_000 });
    await s.run(async () => {
      const started = await startFlash(s.e.app, { buildId: s.build.id, handsFree: keyboard.deps });
      const waiting = await until(() => getFlash(s.e.app, started.id), (f) => f.instruction?.includes("reset button") === true);
      expect(waiting.cancellable).toBe(true);
      await Bun.sleep(100);
      await press();
      const refused = await cancelFlash(s.e.app, started.id).catch((err: unknown) => err);
      expect(refused).toBeInstanceOf(FlashNotCancellableError);
      expect((refused as FlashNotCancellableError).why).toBe("writing");
      const done = await until(() => getFlash(s.e.app, started.id), (f) => f.status === "succeeded" || f.status === "failed", 20_000);
      expect(done.status).toBe("succeeded");
      expect(existsSync(s.e.vars.ZAPP_CALLS)).toBe(true);
    });
  }, 30_000);

  test("a sync's stop signal after the bootloader appears doesn't stop zapp, and the flash finishes", async () => {
    const s = await built();
    const { keyboard, press } = pressedReset(s, { pollMs: 60_000 });
    // SyncEngine.stop() and pause reach the flasher through this signal, as a CLI's Ctrl-C does.
    const stop = new AbortController();
    await s.run(async () => {
      const started = await startFlash(s.e.app, { buildId: s.build.id, handsFree: keyboard.deps, signal: stop.signal });
      await until(() => getFlash(s.e.app, started.id), (f) => f.instruction?.includes("reset button") === true);
      await Bun.sleep(100);
      await press();
      stop.abort();
      const done = await until(() => getFlash(s.e.app, started.id), (f) => f.status === "succeeded" || f.status === "failed", 20_000);
      expect(done.status).toBe("succeeded");
      expect(existsSync(s.e.vars.ZAPP_CALLS)).toBe(true);
    });
  }, 30_000);

  test("a finished flash has nothing to cancel", async () => {
    const s = await built();
    const id = newFlashId();
    createFlash(s.e.app.db, { id, buildId: s.build.id, logPath: `logs/flash-${id}.log` });
    finishFlash(s.e.app.db, id, null);
    const refused = await cancelFlash(s.e.app, id).catch((err: unknown) => err);
    expect((refused as FlashNotCancellableError).why).toBe("finished");
  });
});

describe("Input Monitoring while the Moonlander is restarted", () => {
  test("a refused raw HID write leaves the flash waiting for the reset key, with the permission as a code", async () => {
    const s = await built();
    const keyboard = fakeKeyboard({
      usb: () => [runningKeyboard(OLD)],
      hid: [rawHidOf(OLD)],
      onWrite: () => {
        throw new HidError("macOS refused to open the keyboard's raw HID interface (IOReturn 0xe00002e2)", "permission_input_monitoring");
      },
    });
    await s.run(async () => {
      const started = await startFlash(s.e.app, { buildId: s.build.id, handsFree: keyboard.deps });
      const waiting = await until(() => getFlash(s.e.app, started.id), (f) => f.instructionCode !== null, 15_000);
      expect(waiting).toMatchObject({ status: "waiting_for_bootloader", instructionCode: "permission_input_monitoring", cancellable: true });
      expect(waiting.instruction).toContain("reset button");
      // The page has a button for it, so the instruction names no settings path and no terminal.
      expect(waiting.instruction).toContain("macOS didn't let keyloom restart the keyboard by itself.");
      expect(waiting.instruction).not.toMatch(/terminal|System Settings/);
      await cancelFlash(s.e.app, started.id);
    });
  }, 30_000);
});

describe("Check the keyboard again", () => {
  // A flash that wrote but couldn't confirm the build: its log has no verified line.
  async function unverified() {
    const s = await built();
    const id = newFlashId();
    createFlash(s.e.app.db, { id, buildId: s.build.id, logPath: `logs/flash-${id}.log` });
    await Bun.write(join(s.e.dataDir, `logs/flash-${id}.log`), "keyloom: zapp exited 0\n");
    finishFlash(s.e.app.db, id, null);
    return { ...s, flashId: id };
  }
  const reads = (reading: KeyboardReading) => {
    const calls: number[] = [];
    return { calls, read: async () => { calls.push(1); return new Map([["zsa/moonlander", reading]]); } };
  };

  test("a keyboard that now reports this build makes the flash verified, and History records it", async () => {
    const s = await unverified();
    expect(await getFlash(s.e.app, s.flashId)).toMatchObject({ verified: false, checkable: true });
    const r = reads({ state: "keyloom", keys: [buildKey(s.build.id)], boardRevision: "reva" });
    const checked = await checkFlashAgain(s.e.app, s.flashId, { read: r.read });
    expect(checked.found).toBe("this_build");
    expect(checked.flash).toMatchObject({ verified: true, checkable: false });
    expect(checked.flash.note).toContain(`build ${s.build.id}`);
    expect(s.e.app.db.query("SELECT COUNT(*) AS n FROM versions WHERE revision_id = ?").get(s.build.revisionId)).toEqual({ n: 1 });
  });

  test("a keyboard on another build, unplugged or in its bootloader leaves the flash unverified and says which", async () => {
    const s = await unverified();
    const cases: Array<[KeyboardReading, string]> = [
      [{ state: "keyloom", keys: ["AAAAAAAAAAAA"], boardRevision: "reva" }, "other_build"],
      [{ state: "absent" }, "absent"],
      [{ state: "bootloader" }, "bootloader"],
      [{ state: "other", detail: "USB serial QxKPz" }, "other_firmware"],
    ];
    for (const [reading, found] of cases) {
      const checked = await checkFlashAgain(s.e.app, s.flashId, { read: reads(reading).read });
      expect(checked.found).toBe(found as never);
      expect(checked.flash.verified).toBe(false);
    }
  });

  test("a keyboard that now runs a later build of this copy's says so, so the page never offers to roll it back", async () => {
    const s = await unverified();
    const later = await s.run(() => buildAndWait(s.e.app, "synchronized", { boardRevision: "reva" }));
    expect(later.id).not.toBe(s.build.id);
    const checked = await checkFlashAgain(s.e.app, s.flashId, { read: reads({ state: "keyloom", keys: [buildKey(later.id)], boardRevision: "reva" }).read });
    expect(checked.found).toBe("later_build");
    expect(checked.flash.verified).toBe(false);
    // An earlier build of this copy's is still another build, which Flash again puts this one back over.
    const earlier = await checkFlashAgain(s.e.app, s.flashId, { read: reads({ state: "keyloom", keys: ["AAAAAAAAAAAA"], boardRevision: "reva" }).read });
    expect(earlier.found).toBe("other_build");
    // One half on the later build and one that didn't answer is not "moved on" yet: every half must be read first.
    const half = await checkFlashAgain(s.e.app, s.flashId, { read: reads({ state: "keyloom", keys: [buildKey(later.id)], boardRevision: "reva", missingHalves: ["right half"] }).read });
    expect(half.found).toBe("missing_halves");
  });

  test("only reads: no build, no flash, no restart and no write to the keyboard", async () => {
    const s = await unverified();
    const count = (table: string) => (s.e.app.db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    const before = { builds: count("builds"), flashes: count("flashes"), syncs: count("syncs") };
    // The real reader over fakes: a write to raw HID or a serial touch would show here, and the fake zapp records any run.
    const keyboard = fakeKeyboard({ usb: () => [runningKeyboard(`keyloom/${buildKey(s.build.id)}`)], hid: [rawHidOf(OLD)] });
    const touched: string[] = [];
    const serial = { list: async () => [], touch: async (path: string) => { touched.push(path); } };
    await s.run(async () => {
      const checked = await checkFlashAgain(s.e.app, s.flashId, {
        handsFree: { ...keyboard.deps, zmk: { serial: async () => serial as never, usb: keyboard.deps.usb }, remapper: { endpoint: { host: "127.0.0.1", port: 1 } } },
      });
      expect(checked.found).toBe("this_build");
    });
    expect(keyboard.writes).toEqual([]);
    expect(touched).toEqual([]);
    expect(existsSync(s.e.vars.ZAPP_CALLS)).toBe(false);
    expect({ builds: count("builds"), flashes: count("flashes"), syncs: count("syncs") }).toEqual(before);
  });

  // A Moonlander whose write finished but whose confirmation failed: the flasher's not_confirmed.
  async function notConfirmed() {
    const s = await built();
    const id = newFlashId();
    createFlash(s.e.app.db, { id, buildId: s.build.id, logPath: `logs/flash-${id}.log` });
    await Bun.write(join(s.e.dataDir, `logs/flash-${id}.log`), "keyloom: zapp exited 0\n");
    finishFlash(s.e.app.db, id, { error: "zapp finished, but the Moonlander didn't come back", errorCode: "not_confirmed" });
    return { ...s, flashId: id };
  }
  const versions = (s: Awaited<ReturnType<typeof built>>) => (s.e.app.db.query("SELECT COUNT(*) AS n FROM versions WHERE revision_id = ?").get(s.build.revisionId) as { n: number }).n;

  test("a write that finished but couldn't be confirmed can be checked, and a keyboard on this build makes it a verified success", async () => {
    const s = await notConfirmed();
    expect(await getFlash(s.e.app, s.flashId)).toMatchObject({ status: "failed", errorCode: "not_confirmed", checkable: true });
    const checked = await checkFlashAgain(s.e.app, s.flashId, { read: reads({ state: "keyloom", keys: [buildKey(s.build.id)], boardRevision: "reva" }).read });
    expect(checked.found).toBe("this_build");
    expect(checked.flash).toMatchObject({ status: "succeeded", error: null, errorCode: null, verified: true, checkable: false });
    expect(versions(s)).toBe(1);
  });

  test("a write that couldn't be confirmed and a keyboard on another build stays failed and unverified", async () => {
    const s = await notConfirmed();
    const checked = await checkFlashAgain(s.e.app, s.flashId, { read: reads({ state: "keyloom", keys: ["AAAAAAAAAAAA"], boardRevision: "reva" }).read });
    expect(checked.found).toBe("other_build");
    expect(checked.flash).toMatchObject({ status: "failed", errorCode: "not_confirmed", verified: false, checkable: true });
    expect(versions(s)).toBe(0);
  });

  test("a flash that failed before its write finished can't be checked, and the keyboard is never read", async () => {
    const s = await built();
    const id = newFlashId();
    createFlash(s.e.app.db, { id, buildId: s.build.id, logPath: `logs/flash-${id}.log` });
    finishFlash(s.e.app.db, id, { error: "zapp exited with code 1" });
    expect((await getFlash(s.e.app, id)).checkable).toBe(false);
    const r = reads({ state: "keyloom", keys: [buildKey(s.build.id)], boardRevision: "reva" });
    await expect(checkFlashAgain(s.e.app, id, { read: r.read })).rejects.toThrow("failed before keyloom finished writing it");
    expect(r.calls).toEqual([]);
  });

  test("a read that another flash overtook changes neither the flash's log nor History", async () => {
    const s = await unverified();
    const logPath = join(s.e.dataDir, `logs/flash-${s.flashId}.log`);
    const before = await Bun.file(logPath).text();
    const read = async () => {
      // Another flash starts, and may finish verified, while keyloom reads the keyboard.
      const other = newFlashId();
      createFlash(s.e.app.db, { id: other, buildId: s.build.id, logPath: `logs/flash-${other}.log` });
      finishFlash(s.e.app.db, other, null);
      return new Map<string, KeyboardReading>([["zsa/moonlander", { state: "keyloom", keys: [buildKey(s.build.id)], boardRevision: "reva" }]]);
    };
    await expect(checkFlashAgain(s.e.app, s.flashId, { read })).rejects.toThrow("may be out of date");
    expect(await Bun.file(logPath).text()).toBe(before);
    expect(versions(s)).toBe(0);
    expect((await getFlash(s.e.app, s.flashId)).verified).toBe(false);
  });

  test("a check while another flash runs is refused before the keyboard is read", async () => {
    const s = await unverified();
    const other = newFlashId();
    createFlash(s.e.app.db, { id: other, buildId: s.build.id, logPath: `logs/flash-${other}.log` });
    const r = reads({ state: "keyloom", keys: [buildKey(s.build.id)], boardRevision: "reva" });
    await expect(checkFlashAgain(s.e.app, s.flashId, { read: r.read })).rejects.toThrow("another flash is under way");
    expect(r.calls).toEqual([]);
    expect(versions(s)).toBe(0);
  });

  test("a flash that hasn't finished can't be checked", async () => {
    const s = await built();
    const id = newFlashId();
    createFlash(s.e.app.db, { id, buildId: s.build.id, logPath: `logs/flash-${id}.log` });
    await expect(checkFlashAgain(s.e.app, id, { read: async () => new Map() })).rejects.toThrow("only a finished flash");
  });
});
