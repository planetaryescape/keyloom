// Flashing is only ever tested with fake zapp scripts. A real flash is BK's done-check, never a test.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { dfuProblem, readDfuSuffix } from "../../../src/firmware/qmk/dfu.ts";
import { type FlashState, flashWithZapp } from "../../../src/firmware/qmk/flash.ts";
import { LogSink } from "../../../src/firmware/toolchain/run.ts";
import { dfuImage, fakeBinDir } from "../../helpers/fake-bin.ts";
import { tempDir } from "../../helpers/tmp.ts";

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
    setTimeout(() => c.abort(), 300);
    const r = await s.flash({ signal: c.signal });
    expect(r).toMatchObject({ state: "failed", error: "Cancelled. Nothing was flashed." });
    const pid = Number(await Bun.file(join(s.bin as string, "zapp.pid")).text());
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid, 0)).toThrow(); // gone
  });

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
