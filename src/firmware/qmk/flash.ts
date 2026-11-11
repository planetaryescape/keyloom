// Flashing with ZSA's Zapp (05#flash-uses-zsas-zapp-cli, S11). Zapp's whole CLI is `zapp flash
// <file>`: it validates the file, prints "Firmware loaded", then waits for the keyboard to appear in
// bootloader mode, without any timeout of its own. It prints nothing more until it exits: BK's three
// hands-free flashes (2026-10-22) each logged "Firmware loaded", then the bootloader, then the exit. So the
// write starts the moment the bootloader is on USB, and from then on nothing may stop Zapp (D-506).
import { existsSync } from "node:fs";
import type { FlashNote, FlashPermissionCode, FlashResult, FlashState } from "../toolchain/flash-state.ts";
import { type LogSink, run, which } from "../toolchain/run.ts";
import { holdKeyboardWrite } from "../toolchain/write-guard.ts";
import { dfuProblem } from "./dfu.ts";

export type { FlashNote, FlashResult, FlashState } from "../toolchain/flash-state.ts";

export const BOOTLOADER_WAIT_MS = 120_000;
export const WRITE_TIMEOUT_MS = 180_000;

export const CHECKING_INSTRUCTION = "keyloom is checking whether it can restart the keyboard into its bootloader itself.";

export const HANDS_FREE_INSTRUCTION = "keyloom is restarting the keyboard into its bootloader. There is nothing to press.";

const waitText = (ms: number): string => {
  const minutes = ms / 60_000;
  if (Number.isInteger(minutes)) return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  return `${Math.round(ms / 1000)} seconds`;
};

/** What to press, with how long keyloom will wait for it (the CLI's --wait changes that). */
export const resetInstruction = (waitMs: number = BOOTLOADER_WAIT_MS): string =>
  `Press the reset button on the Moonlander (the small hole on its back; use a paperclip), or press its Reset key if the layout has one. keyloom waits ${waitText(waitMs)}.`;

export const RESET_INSTRUCTION = resetInstruction();

export type FlashInput = {
  artifactPath: string;
  /** `VID:PID` of the bootloader this binary must be built for. */
  bootloader: string;
  log: LogSink;
  /** Called on every state change; `instruction` is what the person must do now. */
  onState: (state: FlashState, instruction: string | null, note?: FlashNote) => void;
  onLine?: (line: string) => void;
  /** The zapp executable; found on PATH when omitted. Tests always pass a fake. */
  zapp?: string;
  bootloaderWaitMs?: number;
  writeTimeoutMs?: number;
  /** Aborting stops zapp. Without this a Ctrl-C would leave it waiting, and it would flash whenever the board next enters its bootloader. */
  signal?: AbortSignal;
  /**
   * Called once zapp is waiting for the bootloader. Resolves ok when it put the keyboard there itself (hands-free,
   * D-070); otherwise `reason` is why the person has to press the reset key as usual. `leftUsbOnly` means the keyboard left USB
   * but its bootloader wasn't seen: it may have been unplugged, so only the bootloader on USB, or Zapp's output, starts the write.
   */
  enterBootloader?: () => Promise<{ ok: true; leftUsbOnly?: true } | { ok: false; reason: string; code?: FlashPermissionCode }>;
  /** Called after zapp exits 0. A failure turns the flash into a failed one, with the keyboard's state in the message. */
  verify?: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
  /**
   * Whether the board's bootloader is on USB now. Zapp writes as soon as it is, without a word, so this is how keyloom knows the
   * write has begun when the person pressed the reset key, and why a cancel that comes after it is refused (D-506).
   */
  bootloaderPresent?: () => Promise<boolean>;
  /** How often the bootloader is looked for while the person is asked to press reset; tests pass a short one. */
  pollMs?: number;
};

const BOOTLOADER_POLL_MS = 250;
/** How many times a failed USB read is tried before keyloom gives up on knowing whether Zapp writes. */
const USB_READ_TRIES = 3;

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
  // A state listener that throws inside the restart's callback: kept, so the restart never rejects unhandled, and thrown once Zapp is done.
  let enteringFailure: unknown;
  let rebooted = false;
  let exited = false;
  // Held while keyloom restarts the keyboard and while Zapp writes, so a Ctrl-C or a shutdown waits for the write (D-506).
  let releaseWrite: (() => void) | undefined;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number, reason: "bootloader" | "write") => {
    clearTimeout(timer);
    timer = setTimeout(() => (reason === "write" ? stop("write") : void stopUnlessWriting("bootloader")), ms);
  };
  const stop = (reason: "bootloader" | "write" | "cancelled") => {
    abortedFor ??= reason;
    controller.abort();
  };
  // Zapp writes the moment the bootloader appears, and says nothing while it does, so this is the write starting. A USB read that
  // returns after Zapp has exited says nothing about this flash: it must not take a hold that nothing would release.
  const startWriting = (how: string) => {
    if (writing || exited || controller.signal.aborted) return;
    writing = true;
    releaseWrite ??= holdKeyboardWrite();
    input.log.line(`keyloom: ${how}; zapp is writing`);
    arm(input.writeTimeoutMs ?? WRITE_TIMEOUT_MS, "write");
    input.onState("writing", "Don't unplug the keyboard. Flashing takes a few seconds.");
  };
  // Undefined when USB couldn't be read, which says nothing either way: Zapp may be writing to a keyboard keyloom can't see.
  const present = async (): Promise<boolean | undefined> => {
    if (!input.bootloaderPresent) return false;
    try {
      return await input.bootloaderPresent();
    } catch {
      return undefined;
    }
  };
  // A cancel or a timeout stops Zapp only while nothing can have been written. Killing it mid-write leaves the keyboard in its
  // bootloader with half an image, so once the bootloader is there the flash finishes, whoever asked to stop it.
  const stopUnlessWriting = async (reason: "bootloader" | "cancelled") => {
    if (writing || exited) return refused(reason);
    // Zapp may write while keyloom looks at USB, so the write guard is held from here until Zapp stops or finishes: a second Ctrl-C
    // during the check would otherwise end keyloom and orphan Zapp in its own process group, to flash whenever the keyboard next
    // enters its bootloader. Cleanup after Zapp exits releases it.
    releaseWrite ??= holdKeyboardWrite();
    // keyloom has sent the restart command: the bootloader is moments away, and only the result says whether Zapp got it.
    if (entering !== undefined) await entering;
    if (!writing && loaded) {
      let seen = await present();
      for (let i = 1; seen === undefined && i < USB_READ_TRIES && !writing && !exited; i++) {
        await Bun.sleep(input.pollMs ?? BOOTLOADER_POLL_MS);
        seen = await present();
      }
      if (seen === true) startWriting("the keyboard is in its bootloader");
      else if (seen === undefined && !writing && !exited) {
        // Not stopped on a guess. A timeout gives Zapp a write's time instead, and then its message says where the keyboard may be.
        // The write guard stays held until Zapp exits; the timers still end Zapp in a fixed time.
        input.log.line("keyloom: couldn't read USB, so zapp may be writing; not stopping it");
        if (reason === "bootloader") arm(input.writeTimeoutMs ?? WRITE_TIMEOUT_MS, "write");
        return;
      }
    }
    if (writing || exited) return refused(reason);
    stop(reason);
  };
  const refused = (reason: "bootloader" | "cancelled") => {
    if (reason === "cancelled") input.log.line("keyloom: not stopping zapp: it is writing to the keyboard, so the flash finishes");
  };
  const cancel = () => void stopUnlessWriting("cancelled");
  if (input.signal?.aborted) stop("cancelled");
  else input.signal?.addEventListener("abort", cancel, { once: true });
  // On the manual path nothing else says the person pressed reset: look for the bootloader on USB until it is there.
  const watch = async () => {
    const pollMs = input.pollMs ?? BOOTLOADER_POLL_MS;
    while (!writing && !exited && !controller.signal.aborted) {
      if ((await present()) === true) startWriting("the keyboard is in its bootloader");
      else await Bun.sleep(pollMs);
    }
  };

  input.log.line(`keyloom: ${zapp} flash ${input.artifactPath}`);
  input.onState("waiting_for_bootloader", input.enterBootloader ? HANDS_FREE_INSTRUCTION : resetInstruction(input.bootloaderWaitMs), input.enterBootloader ? undefined : { needsHand: true });
  arm(input.bootloaderWaitMs ?? BOOTLOADER_WAIT_MS, "bootloader");

  let result: Awaited<ReturnType<typeof run>>;
  try {
    result = await run({
      cmd: [zapp, "flash", input.artifactPath],
      log: input.log,
      signal: controller.signal,
      // Its own process group, so a terminal's Ctrl-C reaches keyloom, which decides, and never Zapp mid-write.
      processGroup: true,
      onLine: (line) => {
        output.push(line);
        input.onLine?.(line);
        if (line.trim() === "") return;
        if (!loaded) {
          if (LOADED.test(line)) {
            loaded = true;
            // The wait starts again here: loading the file is quick, and the person is only asked to act from now.
            // A cancel that came before this line was read has stopped Zapp: restarting the keyboard now would strand it in its bootloader.
            if (controller.signal.aborted) return;
            arm(input.bootloaderWaitMs ?? BOOTLOADER_WAIT_MS, "bootloader");
            // Zapp is now waiting, as it would be for a person pressing the key, so the keyboard can be sent to its bootloader.
            if (input.enterBootloader) {
              const restarting = holdKeyboardWrite();
              entering = input.enterBootloader().then(
                (r) => {
                  rebooted = r.ok;
                  // A keyboard that only left USB may have been unplugged; the bootloader showing up (watch) says the write began.
                  if (r.ok && (r.leftUsbOnly !== true || !input.bootloaderPresent)) startWriting("keyloom restarted the keyboard into its bootloader");
                  else if (r.ok) input.log.line("keyloom: the keyboard left USB; waiting for its bootloader to appear");
                  else {
                    input.log.line(`keyloom: couldn't restart the keyboard itself: ${r.reason}`);
                    // A permission has its own words, with no settings path: the page shows a button for it, and the CLI prints the path (D-501).
                    const why = r.code === "permission_input_monitoring" ? "macOS didn't let keyloom restart the keyboard by itself." : `keyloom couldn't restart the keyboard by itself (${r.reason}).`;
                    input.onState("waiting_for_bootloader", `${why} ${resetInstruction(input.bootloaderWaitMs)}`, { needsHand: true, ...(r.code === undefined ? {} : { problem: r.code }) });
                  }
                },
                (err: unknown) => {
                  input.log.line(`keyloom: couldn't restart the keyboard itself: ${err instanceof Error ? err.message : String(err)}`);
                  input.onState("waiting_for_bootloader", resetInstruction(input.bootloaderWaitMs), { needsHand: true });
                },
              ).finally(restarting).catch((err: unknown) => {
                enteringFailure ??= err;
              });
            }
            if (input.bootloaderPresent) void watch();
          }
          return;
        }
        // Zapp is silent until it finds the board (S11), so any output after "Firmware loaded" means it did.
        startWriting("zapp found the keyboard");
      },
    });
  } finally {
    exited = true;
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", cancel);
    // A rejected run or restart must not leave the guard held, or serve would ignore Ctrl-C for good.
    try {
      await entering;
    } finally {
      releaseWrite?.();
    }
  }
  if (enteringFailure !== undefined) throw enteringFailure;
  // A keyboard keyloom restarted counts as being written (D-506), so only the write timeout below can leave it in its bootloader.
  if (abortedFor === "cancelled" || abortedFor === "bootloader") {
    // Zapp was stopped after a USB check that saw no bootloader, but a reset pressed in between puts the keyboard there with
    // nothing to write it, so the result says where the keyboard is rather than "nothing was flashed".
    const there = await present();
    if (there === true) {
      input.log.line("keyloom: zapp was stopped, but the keyboard is in its bootloader now");
      return fail(`${abortedFor === "cancelled" ? "Cancelled" : "Stopped"} just as the keyboard entered its bootloader. It is still there and won't type until it is flashed: flash again to put the build on it.`, output);
    }
    // An unreadable USB says nothing about where the keyboard is, so the result doesn't claim it.
    if (there === undefined) {
      input.log.line("keyloom: zapp was stopped, and keyloom couldn't read USB to see where the keyboard is");
      return fail(`${abortedFor === "cancelled" ? "Cancelled" : "Stopped"}, and keyloom couldn't read USB to check the keyboard afterwards. If it doesn't type, it is in its bootloader: flash again to put the build on it.`, output);
    }
    if (abortedFor === "cancelled") return fail("Cancelled. Nothing was flashed.", output);
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
    if (input.verify) {
      input.onState("writing", "Written. Waiting for the keyboard to restart so keyloom can confirm it.", { verifying: true });
      const verified = await input.verify();
      // Zapp finished the write; only the confirmation failed, so the keyboard can be read again rather than flashed again.
      if (!verified.ok) return { ...fail(verified.error, output), errorCode: "not_confirmed" };
      input.log.line(`keyloom: ${verified.message}`);
    }
    input.onState("succeeded", null);
    // Hands-free means keyloom put the keyboard in its bootloader and then saw it come back as the new build.
    return { state: "succeeded", error: null, output, handsFree: rebooted && input.verify !== undefined };
  }
  const why = result.exitCode === null ? `was stopped by ${result.signalCode}` : `exited with code ${result.exitCode}`;
  const last = output.filter((l) => l.trim()).slice(-2).join(" | ");
  return fail(`zapp ${why}${last ? `: ${last}` : ""}`, output);
}
