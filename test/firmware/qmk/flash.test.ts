// Flashing is only ever tested with fake zapp scripts. A real flash is BK's done-check, never a test.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { dfuProblem, readDfuSuffix } from "../../../src/firmware/qmk/dfu.ts";
import { HANDS_FREE_INSTRUCTION, RESET_INSTRUCTION, type FlashState, flashWithZapp, resetInstruction } from "../../../src/firmware/qmk/flash.ts";
import { LogSink } from "../../../src/firmware/toolchain/run.ts";
import { keyboardWriteInProgress } from "../../../src/firmware/toolchain/write-guard.ts";
import { dfuImage, fakeBinDir } from "../../helpers/fake-bin.ts";
import { SLOW_RUNNER_MS } from "../../helpers/timeouts.ts";
import { tempDir } from "../../helpers/tmp.ts";

/**
 * The bootloader wait starts when flashing starts and again at "Firmware loaded", so it must outlast starting the fake zapp: at
 * 400 ms a loaded runner timed out before zapp had printed, keyloom never tried the restart, and the stranded warning was missing.
 */
const LOADED_WAIT_MS = 3000;

const REVB = "3297:2003";
const REVA = "0483:df11";

async function setup(zappBody: string | undefined) {
  const dir = tempDir();
  const artifact = join(dir, "build.bin");
  await Bun.write(artifact, dfuImage(REVB));
  const bin = zappBody === undefined ? undefined : fakeBinDir({ zapp: zappBody });
  const states: Array<[FlashState, string | null]> = [];
  const log = new LogSink(join(dir, "flash.log"));
  const flash = (over: Partial<Parameters<typeof flashWithZapp>[0]> = {}) =>
    flashWithZapp({ artifactPath: artifact, bootloader: REVB, log, onState: (s, i) => states.push([s, i]), zapp: bin ? join(bin, "zapp") : join(dir, "no-such-zapp"), ...over });
  return { flash, states, log, artifact, dir, bin };
}

describe("DFU suffix", () => {
  test("reads the bootloader a file was built for and checks its CRC", () => {
    expect(readDfuSuffix(dfuImage(REVA))).toEqual({ vendorId: "0483", productId: "df11", bootloader: REVA, crcOk: true });
    expect(readDfuSuffix(dfuImage(REVB))?.bootloader).toBe(REVB);
    expect(readDfuSuffix(new Uint8Array(40))).toBeUndefined();
    const damaged = dfuImage(REVB);
    damaged[3] = (damaged[3] as number) ^ 0xff;
    expect(readDfuSuffix(damaged)?.crcOk).toBe(false);
  });

  test("a binary for the other revision, a damaged file and a non-firmware file are refused", () => {
    expect(dfuProblem(dfuImage(REVB), REVB)).toBeUndefined();
    expect(dfuProblem(dfuImage(REVA), REVB)).toContain("0483:df11");
    expect(dfuProblem(new Uint8Array(40), REVB)).toContain("no DFU suffix");
    const damaged = dfuImage(REVB);
    damaged[3] = (damaged[3] as number) ^ 0xff;
    expect(dfuProblem(damaged, REVB)).toContain("checksum");
  });
});

describe("flashWithZapp (fake zapp)", () => {
  test("success: waits for the bootloader, then writes, then succeeds on exit 0", async () => {
    const s = await setup('echo "Firmware loaded: STM32 DFU (80 bytes)"; sleep 0.2; echo "Flashing..."; sleep 0.1; echo "Done"; exit 0');
    const r = await s.flash();
    expect(r).toMatchObject({ state: "succeeded", error: null });
    expect(s.states.map(([st]) => st)).toEqual(["waiting_for_bootloader", "writing", "succeeded"]);
    expect(s.states[0]?.[1]).toContain("Press the reset button on the Moonlander");
    expect(s.states[2]?.[1]).toBeNull();
    s.log.close();
    const log = await Bun.file(join(s.dir, "flash.log")).text();
    expect(log).toContain("Firmware loaded");
    expect(log).toContain("zapp exited 0");
  });

  test("no keyboard: zapp waits forever, so keyloom times out, sends SIGTERM and says nothing was flashed", async () => {
    // exec, so the SIGTERM reaches the process that is waiting and not a shell around it.
    const s = await setup('echo "Firmware loaded: STM32 DFU (80 bytes)"; exec sleep 600');
    const started = Date.now();
    const r = await s.flash({ bootloaderWaitMs: 400 });
    expect(r.state).toBe("failed");
    expect(r.error).toContain("No Moonlander in bootloader mode was found");
    expect(r.error).toContain("Nothing was flashed");
    expect(Date.now() - started).toBeLessThan(6000);
    expect(s.states.map(([st]) => st)).toEqual(["waiting_for_bootloader", "failed"]);
  });

  test("Ctrl-C stops zapp, so it can't be left waiting to flash whenever the board next enters its bootloader", async () => {
    const s = await setup('echo $$ > "$0.pid"; echo "Firmware loaded: STM32 DFU (80 bytes)"; exec sleep 600');
    const c = new AbortController();
    // zapp's own "Firmware loaded" line means it is up and waiting (its pid is written before it); a fixed delay
    // aborted before the script had started on a loaded machine.
    const r = await s.flash({ signal: c.signal, onLine: (line) => void (line.includes("Firmware loaded") && c.abort()) });
    expect(r).toMatchObject({ state: "failed", error: "Cancelled. Nothing was flashed." });
    const pid = Number(await Bun.file(join(s.bin as string, "zapp.pid")).text());
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid, 0)).toThrow(); // gone
  }, SLOW_RUNNER_MS);

  test("zapp rejecting the file is a failure that carries its message", async () => {
    const s = await setup('echo "Invalid firmware: not a valid firmware file" >&2; exit 1');
    const r = await s.flash();
    expect(r.state).toBe("failed");
    expect(r.error).toContain("exited with code 1");
    expect(r.error).toContain("Invalid firmware");
  });

  test("a flash that starts writing and then hangs is stopped after the write timeout", async () => {
    const s = await setup('echo "Firmware loaded: x"; echo "Flashing 10%"; exec sleep 600');
    const r = await s.flash({ writeTimeoutMs: 400 });
    expect(r.state).toBe("failed");
    expect(r.error).toContain("didn't finish within 3 minutes");
    expect(s.states.map(([st]) => st)).toEqual(["waiting_for_bootloader", "writing", "failed"]);
  });

  test("zapp failing mid-flash is a failure", async () => {
    const s = await setup('echo "Firmware loaded: x"; echo "Erasing"; echo "device disconnected" >&2; exit 2');
    const r = await s.flash();
    expect(r.state).toBe("failed");
    expect(r.error).toContain("device disconnected");
  });

  test("zapp not installed, a missing file and a wrong-revision binary never reach zapp", async () => {
    const none = await setup(undefined);
    expect((await none.flash({ zapp: join(none.dir, "no-such-zapp") })).error).toContain("brew install zapp");

    const calls = await setup('echo called >> "$0.calls"; exit 0');
    const wrongRev = await calls.flash({ bootloader: REVA });
    expect(wrongRev.state).toBe("failed");
    expect(wrongRev.error).toContain("Not flashing");
    const gone = await calls.flash({ artifactPath: join(calls.dir, "missing.bin") });
    expect(gone.error).toContain("doesn't exist");
    expect(await Bun.file(join(calls.dir, "zapp.calls")).exists()).toBe(false);
  });
});

describe("flashWithZapp, hands-free", () => {
  // A zapp that, like the real one, flashes only once the keyboard is in its bootloader, which the test marks by creating a file.
  const waitsForBootloader = (flag: string) => `echo "Firmware loaded: STM32 DFU (80 bytes)"; while [ ! -f "${flag}" ]; do sleep 0.05; done; echo "Flashing"; sleep 0.1; exit 0`;

  test("the keyboard is restarted once zapp is waiting, and the person is told there is nothing to press", async () => {
    const dir = tempDir();
    const flag = join(dir, "in-bootloader");
    const s = await setup(waitsForBootloader(flag));
    let order: string[] = [];
    const r = await s.flash({
      enterBootloader: async () => {
        order.push("enter");
        await Bun.write(flag, "");
        return { ok: true };
      },
    });
    expect(r).toMatchObject({ state: "succeeded" });
    expect(s.states[0]).toEqual(["waiting_for_bootloader", HANDS_FREE_INSTRUCTION]);
    expect(order).toEqual(["enter"]);
    expect(s.states.map(([st]) => st)).toEqual(["waiting_for_bootloader", "writing", "succeeded"]);
  });

  test("when the keyboard can't be restarted, the person gets the usual instruction with the reason, and the flash still works", async () => {
    const dir = tempDir();
    const flag = join(dir, "in-bootloader");
    const s = await setup(waitsForBootloader(flag));
    setTimeout(() => Bun.write(flag, ""), 500); // the person presses the reset key
    const r = await s.flash({ enterBootloader: async () => ({ ok: false, reason: "the Moonlander is running firmware keyloom didn't build" }) });
    expect(r.state).toBe("succeeded");
    const waiting = s.states.filter(([st]) => st === "waiting_for_bootloader").map(([, i]) => i);
    expect(waiting[0]).toBe(HANDS_FREE_INSTRUCTION);
    expect(waiting[1]).toContain("didn't build");
    expect(waiting[1]).toContain(RESET_INSTRUCTION);
    s.log.close();
    expect(await Bun.file(join(s.dir, "flash.log")).text()).toContain("couldn't restart the keyboard itself");
  });

  test("a restart that throws falls back to the usual instruction instead of failing the flash", async () => {
    const dir = tempDir();
    const flag = join(dir, "in-bootloader");
    const s = await setup(waitsForBootloader(flag));
    setTimeout(() => Bun.write(flag, ""), 300);
    const r = await s.flash({
      enterBootloader: async () => {
        throw new Error("IOKit exploded");
      },
    });
    expect(r.state).toBe("succeeded");
    expect(s.states.some(([, i]) => i === RESET_INSTRUCTION)).toBe(true);
  });

  test("a keyboard keyloom restarted is being written: a zapp that never finishes is stopped only by the write timeout, which says where the keyboard is (D-506)", async () => {
    const s = await setup('echo "Firmware loaded: x"; exec sleep 600');
    const c = new AbortController();
    const r = await s.flash({ bootloaderWaitMs: LOADED_WAIT_MS, writeTimeoutMs: LOADED_WAIT_MS * 2, signal: c.signal, enterBootloader: async () => { setTimeout(() => c.abort(), 20); return { ok: true }; } });
    expect(s.states.map(([st]) => st)).toEqual(["waiting_for_bootloader", "writing", "failed"]);
    expect(r.error).toContain("Flashing didn't finish");
    expect(r.error).toContain("left in its bootloader");
    // The cancel came after the restart, so it was refused and only the write timeout stopped zapp.
    s.log.close();
    expect(await Bun.file(join(s.dir, "flash.log")).text()).toContain("not stopping zapp: it is writing to the keyboard");
  }, SLOW_RUNNER_MS);

  test("a failed restart does not add that warning, because the keyboard was never moved", async () => {
    const s = await setup('echo "Firmware loaded: x"; exec sleep 600');
    const r = await s.flash({ bootloaderWaitMs: LOADED_WAIT_MS, enterBootloader: async () => ({ ok: false, reason: "no raw HID" }) });
    expect(r.error).not.toContain("plugged in again");
  }, SLOW_RUNNER_MS);

  test("after zapp succeeds the flash is verified, and the verdict goes in the log", async () => {
    const s = await setup('echo "Firmware loaded: x"; echo "Flashing"; exit 0');
    const r = await s.flash({ verify: async () => ({ ok: true, message: "Verified: the keyboard is running build bld_X." }) });
    expect(r).toMatchObject({ state: "succeeded", error: null });
    expect(s.states.map(([st]) => st)).toEqual(["waiting_for_bootloader", "writing", "writing", "succeeded"]);
    s.log.close();
    expect(await Bun.file(join(s.dir, "flash.log")).text()).toContain("keyloom: Verified: the keyboard is running build bld_X.");
  });

  test("a keyboard that doesn't come back as the new build makes the flash fail, with the reason", async () => {
    const s = await setup('echo "Firmware loaded: x"; echo "Flashing"; exit 0');
    const r = await s.flash({ verify: async () => ({ ok: false, error: "zapp finished, but the Moonlander didn't come back" }) });
    expect(r).toMatchObject({ state: "failed", error: "zapp finished, but the Moonlander didn't come back" });
    expect(s.states.at(-1)?.[0]).toBe("failed");
  });

  test("a flash zapp reports as failed is not verified", async () => {
    const s = await setup('echo "Firmware loaded: x"; exit 2');
    let verified = false;
    const r = await s.flash({ verify: async () => ((verified = true), { ok: true, message: "Verified: x" }) });
    expect(r.state).toBe("failed");
    expect(verified).toBe(false);
  });
});

/** The process group a pid is in, read with ps, as a terminal sees it: the group its Ctrl-C goes to. */
async function groupOf(pid: number): Promise<number> {
  const ps = Bun.spawn(["ps", "-o", "pgid=", "-p", String(pid)], { stdout: "pipe" });
  return Number((await new Response(ps.stdout).text()).trim());
}

describe("flashWithZapp never lets a stop cut off a write (D-506)", () => {
  test("zapp runs in its own process group, so a terminal's Ctrl-C reaches keyloom and not zapp mid-write", async () => {
    const s = await setup('ps -o pgid= -p $$ > "$0.pgid"; echo "Firmware loaded: x"; echo "Flashing"; exit 0');
    expect((await s.flash()).state).toBe("succeeded");
    const zappGroup = Number((await Bun.file(join(s.bin as string, "zapp.pgid")).text()).trim());
    expect(zappGroup).toBeGreaterThan(0);
    expect(zappGroup).not.toBe(await groupOf(process.pid));
  });

  test("a write is marked in progress while zapp writes, and not after", async () => {
    const s = await setup('echo "Firmware loaded: x"; sleep 0.2; echo "Flashing"; sleep 0.3; exit 0');
    const during: boolean[] = [];
    expect(keyboardWriteInProgress()).toBe(false);
    const r = await s.flash({ onState: (state) => void (state === "writing" && during.push(keyboardWriteInProgress())) });
    expect(r.state).toBe("succeeded");
    expect(during).toEqual([true]);
    expect(keyboardWriteInProgress()).toBe(false);
  });

  test("a keyboard that only left USB is not taken as being written: a cancel still stops zapp when no bootloader appears", async () => {
    const s = await setup('echo "Firmware loaded: x"; exec sleep 600');
    const c = new AbortController();
    const r = await s.flash({
      signal: c.signal, bootloaderWaitMs: LOADED_WAIT_MS * 4, writeTimeoutMs: LOADED_WAIT_MS, pollMs: 20,
      // Unplugged, or restarted into its own firmware: it left USB, and no bootloader ever shows.
      bootloaderPresent: async () => false,
      enterBootloader: async () => {
        setTimeout(() => c.abort(), 50);
        return { ok: true, leftUsbOnly: true };
      },
    });
    expect(r).toMatchObject({ state: "failed", error: "Cancelled. Nothing was flashed." });
    expect(s.states.map(([st]) => st)).not.toContain("writing");
  }, SLOW_RUNNER_MS);

  test("a keyboard that left USB and then shows its bootloader is being written, and a cancel is refused", async () => {
    const dir = tempDir();
    const flag = join(dir, "in-bootloader");
    const s = await setup(`echo "Firmware loaded: x"; while [ ! -f "${flag}" ]; do sleep 0.05; done; sleep 0.3; exit 0`);
    const c = new AbortController();
    let shown = false;
    const r = await s.flash({
      signal: c.signal, pollMs: 20,
      bootloaderPresent: async () => shown,
      onState: (state) => {
        s.states.push([state, null]);
        if (state === "writing") c.abort();
      },
      enterBootloader: async () => {
        setTimeout(() => {
          shown = true;
          void Bun.write(flag, "");
        }, 100);
        return { ok: true, leftUsbOnly: true };
      },
    });
    expect(r.state).toBe("succeeded");
  });

  test("a cancel that lands before zapp's \"Firmware loaded\" line is read never restarts the keyboard", async () => {
    const s = await setup('echo "Firmware loaded: x"; exec sleep 600');
    const c = new AbortController();
    let restarted = false;
    const r = await s.flash({
      signal: c.signal,
      // The cancel arrives while the line is on its way: keyloom has stopped zapp, so the keyboard must stay where it is.
      onLine: (line) => void (line.includes("Firmware loaded") && c.abort()),
      enterBootloader: async () => {
        restarted = true;
        return { ok: true };
      },
    });
    expect(r).toMatchObject({ state: "failed", error: "Cancelled. Nothing was flashed." });
    expect(restarted).toBe(false);
  }, SLOW_RUNNER_MS);

  test("a USB read that fails is not taken as no bootloader: a cancel leaves zapp running, and the flash finishes", async () => {
    const s = await setup('echo "Firmware loaded: x"; sleep 1; echo "Flashing"; exit 0');
    const c = new AbortController();
    const r = await s.flash({
      signal: c.signal, pollMs: 20,
      bootloaderPresent: async () => {
        throw new Error("system_profiler failed");
      },
      onLine: (line) => void (line.includes("Firmware loaded") && setTimeout(() => c.abort(), 100)),
    });
    expect(r.state).toBe("succeeded");
    s.log.close();
    expect(await Bun.file(join(s.dir, "flash.log")).text()).toContain("couldn't read USB, so zapp may be writing");
  }, SLOW_RUNNER_MS);

  test("a cancel that can't read USB holds the write guard while zapp may be writing, so a second Ctrl-C can't orphan it", async () => {
    const s = await setup('echo "Firmware loaded: x"; sleep 1; exit 0');
    const c = new AbortController();
    const held: boolean[] = [];
    const r = await s.flash({
      signal: c.signal, pollMs: 20,
      bootloaderPresent: async () => {
        throw new Error("system_profiler failed");
      },
      onLine: (line) => {
        if (!line.includes("Firmware loaded")) return;
        setTimeout(() => c.abort(), 100);
        setTimeout(() => held.push(keyboardWriteInProgress()), 600);
      },
    });
    expect(r.state).toBe("succeeded");
    expect(held).toEqual([true]);
    expect(keyboardWriteInProgress()).toBe(false);
  }, SLOW_RUNNER_MS);

  test("the write guard is released when the flash throws mid-write, so serve still answers Ctrl-C", async () => {
    const s = await setup('echo "Firmware loaded: x"; echo "Flashing"; exit 0');
    const thrown = await s.flash({
      onState: (state) => {
        if (state === "writing") throw new Error("the state listener broke");
      },
    }).catch((err: unknown) => err);
    expect(thrown).toBeInstanceOf(Error);
    expect(keyboardWriteInProgress()).toBe(false);
  });

  test("the write guard is released when the hands-free restart's own writing step throws", async () => {
    const s = await setup('echo "Firmware loaded: x"; sleep 0.2; exit 0');
    const thrown = await s.flash({
      enterBootloader: async () => ({ ok: true }),
      onState: (state) => {
        if (state === "writing") throw new Error("the state listener broke");
      },
    }).catch((err: unknown) => err);
    expect(thrown).toBeInstanceOf(Error);
    expect(keyboardWriteInProgress()).toBe(false);
  });

  test("after a stop, a USB read that fails says keyloom couldn't check, not that nothing was flashed", async () => {
    const s = await setup('echo "Firmware loaded: x"; exec sleep 600');
    const c = new AbortController();
    let afterCancel = 0;
    const r = await s.flash({
      signal: c.signal,
      pollMs: 60_000,
      // keyloom's own look before stopping zapp sees no bootloader; the look after zapp stops can't read USB.
      bootloaderPresent: async () => {
        if (c.signal.aborted && ++afterCancel > 1) throw new Error("system_profiler failed");
        return false;
      },
      onLine: (line) => void (line.includes("Firmware loaded") && setTimeout(() => c.abort(), 100)),
    });
    expect(r.state).toBe("failed");
    expect(r.error).toContain("couldn't read USB to check the keyboard");
    expect(r.error).not.toContain("Nothing was flashed");
  }, SLOW_RUNNER_MS);

  test("a reset pressed between the USB check and stopping zapp is reported: the keyboard is in its bootloader, not untouched", async () => {
    const s = await setup('echo "Firmware loaded: x"; exec sleep 600');
    const c = new AbortController();
    let afterCancel = 0;
    const r = await s.flash({
      signal: c.signal,
      // The watch looks once, then sleeps past the cancel, so the only looks after it are keyloom's check and the one after zapp stops.
      pollMs: 60_000,
      bootloaderPresent: async () => (c.signal.aborted ? ++afterCancel > 1 : false),
      onLine: (line) => void (line.includes("Firmware loaded") && setTimeout(() => c.abort(), 100)),
    });
    expect(r.state).toBe("failed");
    expect(r.error).toContain("entered its bootloader");
    expect(r.error).toContain("flash again");
    expect(r.error).not.toContain("Nothing was flashed");
  }, SLOW_RUNNER_MS);
});

describe("resetInstruction", () => {
  test("says how long keyloom waits, in minutes when whole and seconds otherwise", () => {
    expect(RESET_INSTRUCTION).toEndWith("keyloom waits 2 minutes.");
    expect(resetInstruction(60_000)).toEndWith("keyloom waits 1 minute.");
    expect(resetInstruction(30 * 60_000)).toEndWith("keyloom waits 30 minutes.");
    expect(resetInstruction(90_000)).toEndWith("keyloom waits 90 seconds.");
  });
});

