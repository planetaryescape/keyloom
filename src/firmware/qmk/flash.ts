// Flashing with ZSA's Zapp (05#flash-uses-zsas-zapp-cli, S11). Zapp's whole CLI is `zapp flash
// <file>`: it validates the file, prints "Firmware loaded", then waits for the keyboard to appear in
// bootloader mode, without any timeout of its own. What it prints on success or failure is not known
// until it has flashed a real board, so this reads its exit code first and everything else loosely,
// and keeps the raw output in the log.
import { existsSync } from "node:fs";
import type { FlashResult, FlashState } from "../toolchain/flash-state.ts";
import { type LogSink, run, which } from "../toolchain/run.ts";
import { dfuProblem } from "./dfu.ts";

export type { FlashResult, FlashState } from "../toolchain/flash-state.ts";

export const BOOTLOADER_WAIT_MS = 120_000;
export const WRITE_TIMEOUT_MS = 180_000;

export const CHECKING_INSTRUCTION = "keyloom is checking whether it can restart the keyboard into its bootloader itself.";

export const HANDS_FREE_INSTRUCTION = "keyloom is restarting the keyboard into its bootloader. There is nothing to press.";

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
  /** Aborting stops zapp. Without this a Ctrl-C would leave it waiting, and it would flash whenever the board next enters its bootloader. */
  signal?: AbortSignal;
  /**
   * Called once zapp is waiting for the bootloader. Resolves ok when it put the keyboard there itself (hands-free,
   * D-070); otherwise `reason` is why the person has to press the reset key as usual.
   */
  enterBootloader?: () => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Called after zapp exits 0. A failure turns the flash into a failed one, with the keyboard's state in the message. */
  verify?: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
};

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
  let abortedFor: "bootloader" | "write" | "cancelled" | undefined;
  let entering: Promise<void> | undefined;
  let rebooted = false;
  const controller = new AbortController();
  const cancel = () => {
    abortedFor ??= "cancelled";
    controller.abort();
  };
  if (input.signal?.aborted) cancel();
  else input.signal?.addEventListener("abort", cancel, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number, reason: "bootloader" | "write") => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      abortedFor = reason;
      controller.abort();
    }, ms);
  };

  input.log.line(`keyloom: ${zapp} flash ${input.artifactPath}`);
  input.onState("waiting_for_bootloader", input.enterBootloader ? HANDS_FREE_INSTRUCTION : RESET_INSTRUCTION);
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
          // Zapp is now waiting, as it would be for a person pressing the key, so the keyboard can be sent to its bootloader.
          if (input.enterBootloader) {
            entering = input.enterBootloader().then(
              (r) => {
                rebooted = r.ok;
                if (!r.ok) {
                  input.log.line(`keyloom: couldn't restart the keyboard itself: ${r.reason}`);
                  input.onState("waiting_for_bootloader", `keyloom couldn't restart the keyboard by itself (${r.reason}). ${RESET_INSTRUCTION}`);
                }
              },
              (err: unknown) => {
                input.log.line(`keyloom: couldn't restart the keyboard itself: ${err instanceof Error ? err.message : String(err)}`);
                input.onState("waiting_for_bootloader", RESET_INSTRUCTION);
              },
            );
          }
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
  input.signal?.removeEventListener("abort", cancel);
  await entering;
  // A keyboard keyloom sent to its bootloader stays there when nothing is written, so the person must be told.
  const stranded = rebooted ? " keyloom restarted the keyboard into its bootloader, so it won't type until it is unplugged and plugged in again, or flashed." : "";

  if (abortedFor === "cancelled") {
    return fail(writing ? "Cancelled while writing. The keyboard may be left in its bootloader: flash again, or flash an earlier build." : `Cancelled. Nothing was flashed.${stranded}`, output);
  }
  if (abortedFor === "bootloader") {
    return fail(`No Moonlander in bootloader mode was found within 2 minutes. Nothing was flashed. Press the reset button and flash again.${stranded}`, output);
  }
  if (abortedFor === "write") {
    return fail(
      "Flashing didn't finish within 3 minutes and was stopped. The keyboard may be left in its bootloader: flash again, or `keyloom flash --build <an earlier build>`.",
      output,
    );
  }
  if (result.exitCode === 0) {
    input.log.line("keyloom: zapp exited 0");
    if (input.verify) {
      input.onState("writing", "Written. Waiting for the keyboard to restart so keyloom can confirm it.");
      const verified = await input.verify();
      if (!verified.ok) return fail(verified.error, output);
      input.log.line(`keyloom: ${verified.message}`);
    }
    input.onState("succeeded", null);
    return { state: "succeeded", error: null, output };
  }
  const why = result.exitCode === null ? `was stopped by ${result.signalCode}` : `exited with code ${result.exitCode}`;
  const last = output.filter((l) => l.trim()).slice(-2).join(" | ");
  return fail(`zapp ${why}${last ? `: ${last}` : ""}`, output);
}
