// Flashing through dfu-programmer, dfu-util and avrdude is only ever tested with fake tools and a fake USB bus. A real flash is BK's
// done-check, never a test (22, D-365).
import { describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DfuToolFlash } from "../../../src/boards/recipes.ts";
import { dfuCommands, flashWithDfuTool, installHint } from "../../../src/firmware/qmk/dfu-flash.ts";
import { LogSink } from "../../../src/firmware/toolchain/run.ts";
import type { UsbDevice } from "../../../src/firmware/toolchain/usb.ts";
import type { FlashState } from "../../../src/firmware/toolchain/flash-state.ts";
import { fakeBinDir } from "../../helpers/fake-bin.ts";
import { SLOW_RUNNER_MS } from "../../helpers/timeouts.ts";
import { tempDir } from "../../helpers/tmp.ts";

const dev = (vendorId: string, productId: string): UsbDevice => ({ vendorId, productId, name: "", maker: "" });
const KEYBOARD = dev("0xcb10", "0x6456");
const ATMEL: DfuToolFlash = { kind: "dfu-tool", tool: "dfu-programmer", mcu: "atmega32u4", bootloader: "03eb:2ff4", enter: "Press the QK_BOOT key." };
const STM32: DfuToolFlash = { kind: "dfu-tool", tool: "dfu-util", bootloader: "0483:df11", enter: "Press RESET." };
const CATERINA: DfuToolFlash = { kind: "dfu-tool", tool: "avrdude", mcu: "atmega32u4", enter: "Press RESET twice." };

/** A fake tool records its arguments, one line per run, and exits as `exit` says. */
const recorder = (log: string, exit = "0") => `echo "$@" >> "${log}"; echo "fake output"; exit ${exit}`;

/** A bus the test controls: the bootloader appears after `bootloaderAfterMs`, and the keyboard comes back once the flasher says it is verifying. */
function world(over: { bootloader?: string; bootloaderAfterMs?: number | null; keyboardBack?: boolean } = {}) {
  const devices: UsbDevice[] = [];
  const [vendor, product] = (over.bootloader ?? "03eb:2ff4").split(":");
  if (over.bootloaderAfterMs !== null) setTimeout(() => devices.push(dev(`0x${vendor}`, `0x${product}`)), over.bootloaderAfterMs ?? 80);
  const states: Array<[FlashState, string | null, boolean]> = [];
  return {
    usb: async () => [...devices],
    states,
    onState: (s: FlashState, i: string | null, note?: { verifying?: true }) => {
      states.push([s, i, note?.verifying === true]);
      // The tool has reset the board: the bootloader is gone and the keyboard enumerates.
      if (note?.verifying && over.keyboardBack !== false) devices.splice(0, devices.length, KEYBOARD);
    },
  };
}

async function setup(tools: Partial<Record<"dfu-programmer" | "dfu-util" | "avrdude", string>>) {
  const dir = tempDir();
  const artifact = join(dir, "build.hex");
  await Bun.write(artifact, ":00000001FF\n");
  const calls = join(dir, "calls.log");
  writeFileSync(calls, "");
  const bin = fakeBinDir(Object.fromEntries(Object.entries(tools).map(([name, body]) => [name, body.replaceAll("$CALLS", calls)])));
  const paths = Object.fromEntries(Object.keys(tools).map((name) => [name, join(bin, name)]));
  const log = new LogSink(join(dir, "flash.log"));
  const called = async () => (await Bun.file(calls).text()).split("\n").filter(Boolean);
  return { dir, artifact, paths, log, called, calls };
}

describe("the commands", () => {
  test("are the ones QMK's flashing guide gives for each tool", () => {
    expect(dfuCommands(ATMEL, "dfu-programmer", "f.hex")).toEqual([
      ["dfu-programmer", "atmega32u4", "erase", "--force"],
      ["dfu-programmer", "atmega32u4", "flash", "--force", "f.hex"],
      ["dfu-programmer", "atmega32u4", "reset"],
    ]);
    expect(dfuCommands(STM32, "dfu-util", "f.bin")).toEqual([["dfu-util", "-a", "0", "-d", "0483:df11", "-s", "0x8000000:leave", "-D", "f.bin"]]);
    expect(dfuCommands(CATERINA, "avrdude", "f.hex", "/dev/cu.usbmodem1")).toEqual([["avrdude", "-p", "atmega32u4", "-c", "avr109", "-P", "/dev/cu.usbmodem1", "-U", "flash:w:f.hex:i"]]);
  });
});

describe("atmel-dfu with a fake dfu-programmer", () => {
  test("waits for the bootloader's USB ID, runs erase, flash and reset, then waits for the keyboard", async () => {
    const s = await setup({ "dfu-programmer": recorder("$CALLS") });
    const w = world();
    const r = await flashWithDfuTool({ artifactPath: s.artifact, recipe: ATMEL, running: { vendorId: "0xcb10", productId: "0x6456" }, log: s.log, usb: w.usb, onState: w.onState, tools: s.paths, pollMs: 20 });
    expect(r).toMatchObject({ state: "succeeded", error: null });
    expect(await s.called()).toEqual(["atmega32u4 erase --force", `atmega32u4 flash --force ${s.artifact}`, "atmega32u4 reset"]);
    expect(w.states.map(([st, , v]) => `${st}${v ? "+verifying" : ""}`)).toEqual(["waiting_for_bootloader", "writing", "writing+verifying", "succeeded"]);
    expect(w.states[0]?.[1]).toContain("Press the QK_BOOT key.");
    s.log.close();
    expect(await Bun.file(join(s.dir, "flash.log")).text()).toContain("dfu-programmer exited 0");
  }, SLOW_RUNNER_MS);

  test("runs nothing when the bootloader never appears, and says nothing was flashed", async () => {
    const s = await setup({ "dfu-programmer": recorder("$CALLS") });
    const w = world({ bootloaderAfterMs: null });
    const started = Date.now();
    const r = await flashWithDfuTool({ artifactPath: s.artifact, recipe: ATMEL, log: s.log, usb: w.usb, onState: w.onState, tools: s.paths, bootloaderWaitMs: 300, pollMs: 20 });
    expect(r.state).toBe("failed");
    expect(r.error).toContain("Nothing was flashed");
    expect(r.error).toContain("03eb:2ff4");
    expect(await s.called()).toEqual([]);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(w.states.map(([st]) => st)).toEqual(["waiting_for_bootloader", "failed"]);
  });

  test("a device with the wrong ID is not taken for the bootloader", async () => {
    const s = await setup({ "dfu-programmer": recorder("$CALLS") });
    const w = world({ bootloader: "0483:df11" });
    const r = await flashWithDfuTool({ artifactPath: s.artifact, recipe: ATMEL, log: s.log, usb: w.usb, onState: w.onState, tools: s.paths, bootloaderWaitMs: 300, pollMs: 20 });
    expect(r.state).toBe("failed");
    expect(await s.called()).toEqual([]);
  });

  test("a failing erase stops the sequence and reports the exit code and the tool's last lines", async () => {
    const s = await setup({ "dfu-programmer": `echo "$@" >> "$CALLS"; echo "dfu-programmer: no device present."; exit 1` });
    const w = world();
    const r = await flashWithDfuTool({ artifactPath: s.artifact, recipe: ATMEL, log: s.log, usb: w.usb, onState: w.onState, tools: s.paths, pollMs: 20 });
    expect(r.state).toBe("failed");
    expect(r.error).toContain("exited with code 1");
    expect(r.error).toContain("no device present");
    expect(r.error).toContain("may be left in its bootloader");
    expect(await s.called()).toEqual(["atmega32u4 erase --force"]);
  }, SLOW_RUNNER_MS);

  test("a reset that fails after a good write is a failed flash", async () => {
    const s = await setup({ "dfu-programmer": `echo "$@" >> "$CALLS"; case "$2" in reset) exit 3;; esac; exit 0` });
    const w = world();
    const r = await flashWithDfuTool({ artifactPath: s.artifact, recipe: ATMEL, log: s.log, usb: w.usb, onState: w.onState, tools: s.paths, pollMs: 20 });
    expect(r.state).toBe("failed");
    expect(r.error).toContain("exited with code 3");
    expect((await s.called()).length).toBe(3);
  }, SLOW_RUNNER_MS);

  test("a keyboard that never comes back is reported, with the write marked as done", async () => {
    const s = await setup({ "dfu-programmer": recorder("$CALLS") });
    const w = world({ keyboardBack: false });
    const r = await flashWithDfuTool({
      artifactPath: s.artifact, recipe: ATMEL, running: { vendorId: "0xcb10", productId: "0x6456" }, log: s.log, usb: w.usb, onState: w.onState, tools: s.paths, comeBackWaitMs: 300, pollMs: 20,
    });
    expect(r.state).toBe("failed");
    expect(r.error).toContain("finished, but the keyboard (cb10:6456) hasn't come back");
    expect(w.states.map(([st]) => st).at(-1)).toBe("failed");
  }, SLOW_RUNNER_MS);

  test("a board with no USB ids to look for succeeds on exit 0 and says it could not confirm", async () => {
    const s = await setup({ "dfu-programmer": recorder("$CALLS") });
    const w = world();
    const r = await flashWithDfuTool({ artifactPath: s.artifact, recipe: ATMEL, log: s.log, usb: w.usb, onState: w.onState, tools: s.paths, pollMs: 20 });
    expect(r.state).toBe("succeeded");
    s.log.close();
    expect(await Bun.file(join(s.dir, "flash.log")).text()).toContain("can't confirm it restarted");
  }, SLOW_RUNNER_MS);

  test("cancelling while it waits runs nothing", async () => {
    const s = await setup({ "dfu-programmer": recorder("$CALLS") });
    const w = world({ bootloaderAfterMs: null });
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 100);
    const r = await flashWithDfuTool({ artifactPath: s.artifact, recipe: ATMEL, log: s.log, usb: w.usb, onState: w.onState, tools: s.paths, signal: abort.signal, pollMs: 20 });
    expect(r.state).toBe("failed");
    expect(r.error).toContain("Cancelled. Nothing was flashed.");
    expect(await s.called()).toEqual([]);
  });

  test("a tool that hangs while writing is stopped at the write timeout", async () => {
    const s = await setup({ "dfu-programmer": `echo "$@" >> "$CALLS"; exec sleep 600` });
    const w = world();
    const r = await flashWithDfuTool({ artifactPath: s.artifact, recipe: ATMEL, log: s.log, usb: w.usb, onState: w.onState, tools: s.paths, writeTimeoutMs: 400, pollMs: 20 });
    expect(r.state).toBe("failed");
    expect(r.error).toContain("didn't finish");
    expect(await s.called()).toEqual(["atmega32u4 erase --force"]);
  }, SLOW_RUNNER_MS);
});

describe("stm32-dfu with a fake dfu-util", () => {
  test("waits for 0483:df11, writes the .bin at the STM32 flash address and leaves", async () => {
    const s = await setup({ "dfu-util": recorder("$CALLS") });
    const bin = join(s.dir, "build.bin");
    await Bun.write(bin, new Uint8Array(64));
    const w = world({ bootloader: "0483:df11" });
    const r = await flashWithDfuTool({ artifactPath: bin, recipe: STM32, running: { vendorId: "0xcb10", productId: "0x6456" }, log: s.log, usb: w.usb, onState: w.onState, tools: s.paths, pollMs: 20 });
    expect(r.state).toBe("succeeded");
    expect(await s.called()).toEqual([`-a 0 -d 0483:df11 -s 0x8000000:leave -D ${bin}`]);
  }, SLOW_RUNNER_MS);
});

describe("caterina with a fake avrdude", () => {
  test("takes the serial port that appears after the reset prompt, and writes through it", async () => {
    const s = await setup({ avrdude: recorder("$CALLS") });
    const port = join(s.dir, "cu.usbmodem1101");
    const present: string[] = [join(s.dir, "cu.usbmodem-other")];
    setTimeout(() => {
      writeFileSync(port, "");
      chmodSync(port, 0o600);
      present.push(port);
    }, 100);
    const w = world({ bootloaderAfterMs: null });
    const r = await flashWithDfuTool({
      artifactPath: s.artifact, recipe: CATERINA, running: { vendorId: "0xcb10", productId: "0x6456" }, log: s.log, usb: w.usb, ports: async () => [...present], onState: w.onState, tools: s.paths, pollMs: 20,
    });
    expect(r.state).toBe("succeeded");
    expect(await s.called()).toEqual([`-p atmega32u4 -c avr109 -P ${port} -U flash:w:${s.artifact}:i`]);
    expect(w.states[0]?.[1]).toContain("Press RESET twice.");
  }, SLOW_RUNNER_MS);

  test("a port that was already there is not the bootloader", async () => {
    const s = await setup({ avrdude: recorder("$CALLS") });
    const w = world({ bootloaderAfterMs: null });
    const r = await flashWithDfuTool({ artifactPath: s.artifact, recipe: CATERINA, log: s.log, usb: w.usb, ports: async () => ["/dev/cu.usbmodem9"], onState: w.onState, tools: s.paths, bootloaderWaitMs: 300, pollMs: 20 });
    expect(r.state).toBe("failed");
    expect(r.error).toContain("Nothing was flashed");
    expect(await s.called()).toEqual([]);
  });
});

describe("before anything runs", () => {
  test("a tool that isn't installed says how to install it and starts no wait", async () => {
    const s = await setup({});
    const w = world();
    const r = await flashWithDfuTool({ artifactPath: s.artifact, recipe: ATMEL, log: s.log, usb: w.usb, onState: w.onState, tools: { "dfu-programmer": join(s.dir, "no-such-tool") } });
    expect(r.state).toBe("failed");
    expect(r.error).toBe(installHint("dfu-programmer"));
    expect(r.error).toContain("brew install dfu-programmer");
    expect(w.states.map(([st]) => st)).toEqual(["failed"]);
  });

  test("a missing or empty firmware file is refused", async () => {
    const s = await setup({ "dfu-programmer": recorder("$CALLS") });
    const w = world();
    const missing = await flashWithDfuTool({ artifactPath: join(s.dir, "nope.hex"), recipe: ATMEL, log: s.log, usb: w.usb, onState: w.onState, tools: s.paths });
    expect(missing.error).toContain("doesn't exist");
    await Bun.write(join(s.dir, "empty.hex"), "");
    const empty = await flashWithDfuTool({ artifactPath: join(s.dir, "empty.hex"), recipe: ATMEL, log: s.log, usb: w.usb, onState: w.onState, tools: s.paths });
    expect(empty.error).toContain("is empty");
    expect(await s.called()).toEqual([]);
  });

  test("the blocked tools on the tests' PATH refuse to run when a test forgets its fake", async () => {
    const s = await setup({});
    const w = world();
    const r = await flashWithDfuTool({ artifactPath: s.artifact, recipe: ATMEL, log: s.log, usb: w.usb, onState: w.onState, pollMs: 20 });
    expect(r.state).toBe("failed");
    expect(r.error).toContain("blocked in tests");
  }, SLOW_RUNNER_MS);
});
