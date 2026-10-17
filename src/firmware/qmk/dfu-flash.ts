// Flashing a QMK board through a command-line DFU tool (22, D-365): dfu-programmer for atmel-dfu, dfu-util for stm32-dfu and avrdude
// (avr109) for caterina. keyloom waits for the bootloader to show up, runs the tool's commands, checks each exited 0, and then waits
// for the keyboard to come back running. The commands are the ones QMK's own `make` targets and docs/flashing.md run; none has been run
// against a real board by keyloom (S43). USB and serial ports are parameters, so tests use fakes and never touch a keyboard.
import { accessSync, constants, existsSync } from "node:fs";
import type { DfuToolFlash } from "../../boards/recipes.ts";
import type { FlashNote, FlashResult, FlashState } from "../toolchain/flash-state.ts";
import { type LogSink, run, which } from "../toolchain/run.ts";
import { type UsbDevice, listUsbDevices } from "../toolchain/usb.ts";

export const BOOTLOADER_WAIT_MS = 120_000;
export const WRITE_TIMEOUT_MS = 180_000;
/** How long the keyboard gets to enumerate again after the tool has reset it. */
export const COME_BACK_WAIT_MS = 30_000;
export const POLL_MS = 250;

export type DfuTool = DfuToolFlash["tool"];

/** The Homebrew formula that installs each tool; all three are in homebrew-core. */
export const BREW_FORMULA: Record<DfuTool, string> = { "dfu-programmer": "dfu-programmer", "dfu-util": "dfu-util", avrdude: "avrdude" };

export const installHint = (tool: DfuTool): string => `${tool} isn't installed. Install it with \`brew install ${BREW_FORMULA[tool]}\`, then flash again.`;

export type DfuFlashInput = {
  artifactPath: string;
  recipe: DfuToolFlash;
  /** The ids the keyboard reports while its firmware runs (`0xcb10`), to wait for it after the flash. Without them nothing can be checked. */
  running?: { vendorId: string; productId: string };
  log: LogSink;
  onState: (state: FlashState, instruction: string | null, note?: FlashNote) => void;
  onLine?: (line: string) => void;
  /** Always passed in by tests; the default reads the machine's USB bus. */
  usb?: () => Promise<UsbDevice[]>;
  /** The serial ports there are now, for Caterina's new-port wait. The default lists /dev. */
  ports?: () => Promise<string[]>;
  /** Executables to use in place of the ones on PATH; tests always pass fakes. */
  tools?: Partial<Record<DfuTool, string>>;
  bootloaderWaitMs?: number;
  writeTimeoutMs?: number;
  comeBackWaitMs?: number;
  pollMs?: number;
  signal?: AbortSignal;
};

const waitText = (ms: number): string => {
  const minutes = ms / 60_000;
  if (Number.isInteger(minutes)) return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  return `${Math.max(1, Math.round(ms / 1000))} seconds`;
};

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

/** Serial ports a Caterina bootloader can appear as: macOS `cu.usbmodem…`, Linux `ttyACM…`. Read-only. */
export async function listSerialPorts(): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  try {
    return (await readdir("/dev")).filter((n) => /^(cu\.usbmodem|ttyACM)/.test(n)).map((n) => `/dev/${n}`);
  } catch {
    return [];
  }
}

/** The commands the tool is run with, in order. `port` is the Caterina serial port. */
export function dfuCommands(recipe: DfuToolFlash, tool: string, file: string, port?: string): string[][] {
  if (recipe.tool === "dfu-programmer") {
    const mcu = recipe.mcu as string;
    // `--force` on erase and flash is what QMK's `:dfu` target and docs/flashing.md use for dfu-programmer 0.7 and later.
    return [[tool, mcu, "erase", "--force"], [tool, mcu, "flash", "--force", file], [tool, mcu, "reset"]];
  }
  if (recipe.tool === "dfu-util") {
    return [[tool, "-a", "0", "-d", recipe.bootloader as string, "-s", "0x8000000:leave", "-D", file]];
  }
  return [[tool, "-p", recipe.mcu as string, "-c", "avr109", "-P", port as string, "-U", `flash:w:${file}:i`]];
}

const idText = (vendorId: string, productId: string): string => `${vendorId.slice(2)}:${productId.slice(2)}`;

const isDevice = (d: UsbDevice, id: string): boolean => {
  const [vendor, product] = id.split(":");
  return d.vendorId === `0x${vendor}` && d.productId === `0x${product}`;
};

export async function flashWithDfuTool(input: DfuFlashInput): Promise<FlashResult> {
  const { recipe } = input;
  const pollMs = input.pollMs ?? POLL_MS;
  const usb = input.usb ?? listUsbDevices;
  const ports = input.ports ?? listSerialPorts;
  const fail = (error: string, output: string[] = []): FlashResult => {
    input.log.line(`keyloom: ${error}`);
    input.onState("failed", null);
    return { state: "failed", error, output };
  };

  // Never a bare name that spawn might resolve against a different PATH: what is checked is what runs.
  const override = input.tools?.[recipe.tool];
  const tool = override === undefined ? which(recipe.tool) : existsSync(override) ? override : null;
  if (!tool) return fail(installHint(recipe.tool));

  const file = Bun.file(input.artifactPath);
  if (!(await file.exists())) return fail(`${input.artifactPath} doesn't exist; build it again.`);
  if (file.size === 0) return fail(`${input.artifactPath} is empty; build it again.`);

  const output: string[] = [];
  // An object, not a variable: the abort handlers set it from outside the flow TypeScript follows.
  const stopped: { reason?: "bootloader" | "write" | "cancelled" } = {};
  const controller = new AbortController();
  const stoppedFor = (): typeof stopped.reason => stopped.reason;
  const cancel = () => {
    stopped.reason ??= "cancelled";
    controller.abort();
  };
  if (input.signal?.aborted) cancel();
  else input.signal?.addEventListener("abort", cancel, { once: true });
  const cleanup = () => input.signal?.removeEventListener("abort", cancel);

  const bootloaderMs = input.bootloaderWaitMs ?? BOOTLOADER_WAIT_MS;
  const what = recipe.bootloader === undefined ? "a Caterina bootloader" : `a ${recipe.bootloader} bootloader`;
  // The ports there are before the person resets the board, so the one the bootloader adds can be told from the rest.
  const portsBefore = recipe.tool === "avrdude" ? new Set(await ports()) : undefined;

  input.log.line(`keyloom: waiting for ${what}; will run ${recipe.tool} on ${input.artifactPath}`);
  input.onState("waiting_for_bootloader", `${recipe.enter} keyloom waits ${waitText(bootloaderMs)}.`, { needsHand: true });

  // --- wait for the bootloader -----------------------------------------------------------
  let port: string | undefined;
  const deadline = Date.now() + bootloaderMs;
  while (stopped.reason === undefined) {
    if (recipe.bootloader !== undefined) {
      if ((await usb()).some((d) => isDevice(d, recipe.bootloader as string))) break;
    } else {
      const added = (await ports()).find((p) => !(portsBefore as Set<string>).has(p));
      if (added !== undefined) {
        port = added;
        input.log.line(`keyloom: ${added} has appeared; taking it to be the bootloader`);
        // QMK waits for the port to be writable before avrdude opens it.
        while (stopped.reason === undefined && Date.now() < deadline) {
          try {
            accessSync(added, constants.W_OK);
            break;
          } catch {
            await sleep(pollMs, controller.signal);
          }
        }
        break;
      }
    }
    if (Date.now() >= deadline) stopped.reason = "bootloader";
    else await sleep(pollMs, controller.signal);
  }
  if (stopped.reason === "cancelled") {
    cleanup();
    return fail("Cancelled. Nothing was flashed.");
  }
  if (stopped.reason === "bootloader") {
    cleanup();
    return fail(`No ${what} was found within ${waitText(bootloaderMs)}. Nothing was flashed. Put the board in its bootloader and flash again.`);
  }

  // --- write ---------------------------------------------------------------------------
  input.onState("writing", "Don't unplug the keyboard. Flashing takes a few seconds.");
  const timer = setTimeout(() => {
    stopped.reason = "write";
    controller.abort();
  }, input.writeTimeoutMs ?? WRITE_TIMEOUT_MS);
  let failure: string | undefined;
  for (const cmd of dfuCommands(recipe, tool, input.artifactPath, port)) {
    input.log.line(`keyloom: ${cmd.join(" ")}`);
    const lines: string[] = [];
    const result = await run({
      cmd,
      log: input.log,
      signal: controller.signal,
      onLine: (line) => {
        lines.push(line);
        output.push(line);
        input.onLine?.(line);
      },
    });
    if (result.exitCode === 0) {
      input.log.line(`keyloom: ${recipe.tool} exited 0`);
      continue;
    }
    const why = result.exitCode === null ? `was stopped by ${result.signalCode}` : `exited with code ${result.exitCode}`;
    const last = lines.filter((l) => l.trim()).slice(-2).join(" | ");
    failure = `${recipe.tool} ${why}${last ? `: ${last}` : ""}`;
    break;
  }
  clearTimeout(timer);
  cleanup();
  if (stoppedFor() === "cancelled") return fail("Cancelled while writing. The keyboard may be left in its bootloader: flash again, or flash an earlier build.", output);
  if (stoppedFor() === "write") {
    return fail(`Flashing didn't finish within ${waitText(input.writeTimeoutMs ?? WRITE_TIMEOUT_MS)} and was stopped. The keyboard may be left in its bootloader: flash again, or flash an earlier build.`, output);
  }
  if (failure !== undefined) return fail(`${failure}. The keyboard may be left in its bootloader: flash again, or flash an earlier build.`, output);

  // --- the keyboard comes back -----------------------------------------------------------
  if (input.running === undefined) {
    input.log.line("keyloom: this board has no USB ids to look for, so keyloom can't confirm it restarted");
  } else {
    const { vendorId, productId } = input.running;
    input.onState("writing", "Written. Waiting for the keyboard to restart so keyloom can confirm it.", { verifying: true });
    const back = Date.now() + (input.comeBackWaitMs ?? COME_BACK_WAIT_MS);
    let seen = false;
    while (!seen && Date.now() < back) {
      seen = (await usb()).some((d) => d.vendorId === vendorId && d.productId === productId);
      if (!seen) await sleep(pollMs);
    }
    if (!seen) {
      return fail(
        `${recipe.tool} finished, but the keyboard (${idText(vendorId, productId)}) hasn't come back within ${waitText(input.comeBackWaitMs ?? COME_BACK_WAIT_MS)}. Unplug it and plug it in again; if it still doesn't type, flash an earlier build.`,
        output,
      );
    }
    input.log.line(`keyloom: the keyboard is back (${idText(vendorId, productId)})`);
  }
  input.onState("succeeded", null);
  return { state: "succeeded", error: null, output };
}
