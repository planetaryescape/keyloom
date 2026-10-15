// Flashing with ZSA's Zapp (05#flash-uses-zsas-zapp-cli, S11). Zapp's whole CLI is `zapp flash
// <file>`: it validates the file, prints "Firmware loaded", then waits for the keyboard to appear in
// bootloader mode, without any timeout of its own. What it prints on success or failure is not known
// until it has flashed a real board, so this reads its exit code first and everything else loosely,
// and keeps the raw output in the log.
import { existsSync } from "node:fs";
import { type LogSink, run, which } from "../toolchain/run.ts";
import { dfuProblem } from "./dfu.ts";

export type FlashState = "waiting_for_bootloader" | "writing" | "succeeded" | "failed";

export const BOOTLOADER_WAIT_MS = 120_000;
export const WRITE_TIMEOUT_MS = 180_000;

export const RESET_INSTRUCTION =
  "Press the reset button on the Moonlander (the small hole on its back; use a paperclip), or press its Reset key if the layout has one. keyloom waits 2 minutes.";

export type FlashInput = {
  artifactPath: string;
  /** `VID:PID` of the bootloader this binary must be built for. */
  bootloader: string;
  log: LogSink;
  /** Called on every state change; `instruction` is what the person must do now. */
  onState: (state: FlashState, instruction: string | null) => void;
  onLine?: (line: string) => void;
  /** The zapp executable; found on PATH when omitted. Tests always pass a fake. */
  zapp?: string;
  bootloaderWaitMs?: number;
  writeTimeoutMs?: number;
};

export type FlashResult = { state: "succeeded" | "failed"; error: string | null; output: string[] };

const LOADED = /firmware loaded/i;

export async function flashWithZapp(input: FlashInput): Promise<FlashResult> {
  const fail = (error: string, output: string[] = []): FlashResult => {
    input.log.line(`keyloom: ${error}`);
    input.onState("failed", null);
    return { state: "failed", error, output };
  };

  // Never a bare name that spawn might resolve against a different PATH: what is checked is what runs.
  const zapp = input.zapp === undefined ? which("zapp") : existsSync(input.zapp) ? input.zapp : null;
  if (!zapp) return fail("zapp isn't installed. Install it with `brew install zapp`, then flash again.");

  const file = Bun.file(input.artifactPath);
  if (!(await file.exists())) return fail(`${input.artifactPath} doesn't exist; build it again.`);
  const problem = dfuProblem(new Uint8Array(await file.arrayBuffer()), input.bootloader);
  if (problem) return fail(`Not flashing: ${problem}.`);

  const output: string[] = [];
  let loaded = false;
  let writing = false;
  let abortedFor: "bootloader" | "write" | undefined;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number, reason: "bootloader" | "write") => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      abortedFor = reason;
      controller.abort();
    }, ms);
  };

  input.log.line(`keyloom: ${zapp} flash ${input.artifactPath}`);
  input.onState("waiting_for_bootloader", RESET_INSTRUCTION);
  arm(input.bootloaderWaitMs ?? BOOTLOADER_WAIT_MS, "bootloader");

  const result = await run({
    cmd: [zapp, "flash", input.artifactPath],
    log: input.log,
    signal: controller.signal,
    onLine: (line) => {
      output.push(line);
      input.onLine?.(line);
      if (line.trim() === "") return;
      if (!loaded) {
        if (LOADED.test(line)) {
          loaded = true;
          // The wait starts again here: loading the file is quick, and the person is only asked to act from now.
          arm(input.bootloaderWaitMs ?? BOOTLOADER_WAIT_MS, "bootloader");
        }
        return;
      }
      // Zapp is silent until it finds the board (S11), so output after "Firmware loaded" means it did.
      if (!writing) {
        writing = true;
        arm(input.writeTimeoutMs ?? WRITE_TIMEOUT_MS, "write");
        input.onState("writing", "Don't unplug the keyboard. Flashing takes a few seconds.");
      }
    },
  });
  clearTimeout(timer);

  if (abortedFor === "bootloader") {
    return fail("No Moonlander in bootloader mode was found within 2 minutes. Nothing was flashed. Press the reset button and flash again.", output);
  }
  if (abortedFor === "write") {
    return fail(
      "Flashing didn't finish within 3 minutes and was stopped. The keyboard may be left in its bootloader: flash again, or `keyloom flash --build <an earlier build>`.",
      output,
    );
  }
  if (result.exitCode === 0) {
    input.log.line("keyloom: zapp exited 0");
    input.onState("succeeded", null);
    return { state: "succeeded", error: null, output };
  }
  const why = result.exitCode === null ? `was stopped by ${result.signalCode}` : `exited with code ${result.exitCode}`;
  const last = output.filter((l) => l.trim()).slice(-2).join(" | ");
  return fail(`zapp ${why}${last ? `: ${last}` : ""}`, output);
}
