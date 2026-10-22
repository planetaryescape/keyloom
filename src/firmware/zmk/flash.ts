// Flashing by copying the UF2 to each half's boot drive (06#flash-copies-the-uf2-to-each-halfs-boot-drive, D-038).
// Each half's bootloader shows up as a USB drive. Writing a UF2 to it flashes the half, and the
// bootloader unmounts the drive itself when the write was good, so the drive disappearing is the
// success signal. Both halves take the same combined file; MoErgo says to do the right half first, and
// the board definition lists the steps in the order to run them.
import { open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync } from "fflate";
import type { FlashStep } from "../../boards/recipes.ts";
import type { FlashNote, FlashResult, FlashState } from "../toolchain/flash-state.ts";
import type { LogSink } from "../toolchain/run.ts";
import { type Uf2Shape, describeUf2, inspectUf2, uf2Problem } from "../toolchain/uf2.ts";
import type { VolumeFinder } from "./volumes.ts";

export const BOOTLOADER_WAIT_MS = 120_000;
export const UNMOUNT_WAIT_MS = 30_000;
/** How long a freshly mounted boot drive may refuse the write before the refusal is reported. */
export const WRITE_RETRY_MS = 8_000;
/** How long a drive may stay listed after a device-gone write error before the error counts as a failed flash. */
export const GONE_WAIT_MS = 3_000;
export const POLL_MS = 500;

export const ZMK_CHECKING_INSTRUCTION = "keyloom is checking whether it can restart the keyboard's halves into their bootloaders itself.";

export const WRITING_INSTRUCTION = "Don't unplug or switch off the half. Writing takes a few seconds, and the drive disappears when it is done.";

export type { FlashStep } from "../../boards/recipes.ts";

/** `alreadyThere`: the half was in its bootloader before keyloom tried, so keyloom proved nothing about reaching it. */
export type EnterResult = { ok: true; alreadyThere?: true } | { ok: false; reason: string };
export type VerifyResult = { ok: true; message: string } | { ok: false; error: string };

/** What hands-free flashing adds to each step (src/firmware/zmk/handsfree-flash.ts); without it the person puts every half in its bootloader. */
export type RestoreStep = (index: number, image: Uint8Array, verify: () => Promise<VerifyResult>, instruction?: string) => Promise<VerifyResult>;

export type StepHooks = {
  /**
   * Gets the half into its bootloader without a keypress. `announce` says what the person should know once a restart is under way.
   * A failure is a reason, and the flash goes on by asking for the key combo.
   */
  enterBootloader?: (step: FlashStep, index: number, announce: (instruction: string) => void) => Promise<EnterResult>;
  /** Called with the image just written, after the drive has unmounted: did the half come back running it? A failure stops the flash. */
  verify?: (step: FlashStep, index: number, image: Uint8Array) => Promise<VerifyResult>;
  /** Promote verified images only once the entire flash has passed. */
  complete?: () => Promise<void>;
  /** Recover a partial flash through the same copy path, without recursively attempting recovery. */
  recover?: (index: number, error: string, restore: RestoreStep, say: (line: string) => void) => Promise<string>;
};

export type Uf2FlashInput = {
  artifactPath: string;
  steps: readonly FlashStep[];
  /** What a plain `.uf2` artifact holds: a Glove80's two halves in one file (default), or one image. A `.zip` bundle always holds single images. */
  shape?: Uf2Shape;
  /** Name of the file written to a boot drive; bootloaders accept any `.uf2` name. Defaults to the Glove80's. */
  driveFileName?: string;
  /** Always passed in: tests give a finder over a temporary directory, so nothing here can reach a real keyboard by default. */
  findVolume: VolumeFinder;
  hooks?: StepHooks;
  log: LogSink;
  /** Called on every state change; `instruction` is what the person must do now. */
  onState: (state: FlashState, instruction: string | null, note?: FlashNote) => void;
  onLine?: (line: string) => void;
  bootloaderWaitMs?: number;
  /** How long to retry a write the drive refuses (EACCES/EPERM); defaults to WRITE_RETRY_MS. */
  /** Writes the image to the drive; the real file write by default. Tests pass one that fails the way a rebooting bootloader does. */
  writeImage?: (path: string, bytes: Uint8Array) => Promise<void>;
  /** How long to wait for the drive to unmount after a device-gone write error; defaults to GONE_WAIT_MS. */
  goneWaitMs?: number;
  writeRetryMs?: number;
  unmountWaitMs?: number;
  pollMs?: number;
  signal?: AbortSignal;
};

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

/**
 * What each step writes. A `.zip` artifact is a bundle with one `<target>.uf2` per build target (a split
 * board built from upstream ZMK); any other artifact is the one file every step writes (a Glove80).
 */
async function payloads(input: Uf2FlashInput, say: (line: string) => void): Promise<Uint8Array[] | { error: string }> {
  const file = Bun.file(input.artifactPath);
  if (!(await file.exists())) return { error: `${input.artifactPath} doesn't exist; build it again.` };
  const bytes = new Uint8Array(await file.arrayBuffer());
  let result: Uint8Array[];
  let shape: Uf2Shape = input.shape ?? "halves";
  if (input.artifactPath.endsWith(".zip")) {
    shape = "single";
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(bytes);
    } catch (err) {
      return { error: `Not flashing: ${input.artifactPath} isn't a readable bundle (${(err as Error).message}).` };
    }
    result = [];
    for (const step of input.steps) {
      const entry = step.target === undefined ? undefined : entries[`${step.target}.uf2`];
      if (!entry) return { error: `Not flashing: the build has no ${step.target ?? "target"}.uf2 for the ${step.label}. Build again.` };
      result.push(entry);
    }
  } else {
    result = input.steps.map(() => bytes);
  }
  for (const [i, data] of result.entries()) {
    const problem = uf2Problem(data, shape);
    if (problem) return { error: `Not flashing: ${problem}.` };
    const info = inspectUf2(data);
    if ("problem" in info || (i > 0 && data === result[0])) continue;
    say(shape === "single" && result.length > 1 ? `keyloom: the ${input.steps[i]?.label} file is ${describeUf2(info)}` : `keyloom: ${input.artifactPath} is ${describeUf2(info)}`);
  }
  return result;
}

export const instructionFor = (step: FlashStep, index: number, total: number, waitMs: number): string =>
  `Flash the ${step.label} (${index + 1} of ${total}). ${step.enter} keyloom waits ${Math.round(waitMs / 60_000) >= 1 ? `${Math.round(waitMs / 60_000)} minutes` : `${Math.round(waitMs / 1000)} seconds`}.`;

export async function flashUf2Drives(input: Uf2FlashInput): Promise<FlashResult> {
  const output: string[] = [];
  const say = (line: string) => {
    output.push(line);
    input.log.line(line);
    input.onLine?.(line);
  };
  const fail = (error: string): FlashResult => {
    say(`keyloom: ${error}`);
    input.onState("failed", null);
    return { state: "failed", error, output };
  };
  const poll = input.pollMs ?? POLL_MS;
  const waitMs = input.bootloaderWaitMs ?? BOOTLOADER_WAIT_MS;

  const files = await payloads(input, say);
  if ("error" in files) return fail(files.error);

  const verified: string[] = [];
  let allRestarted = true;
  const attempt = async (i: number, image: Uint8Array, recovery?: { verify: () => Promise<VerifyResult>; instruction?: string }): Promise<VerifyResult> => {
    const step = input.steps[i] as FlashStep;
    // Cancelling the new build must not cancel restoring the previous one.
    const signal = recovery ? undefined : input.signal;
    const failed = (error: string): VerifyResult => ({ ok: false, error });
    let instruction = recovery?.instruction ?? instructionFor(step, i, input.steps.length, waitMs);
    let restarted = false;
    let byKeyloom = false;
    if (input.hooks?.enterBootloader && recovery?.instruction === undefined) {
      const entered = await input.hooks.enterBootloader(step, i, (text) => input.onState("waiting_for_bootloader", text));
      if (!entered.ok) {
        say(`keyloom: couldn't restart the ${step.label} by itself: ${entered.reason}`);
        instruction = `keyloom couldn't restart the ${step.label} by itself: ${entered.reason}. ${instruction}`;
      }
      restarted = entered.ok;
      byKeyloom = entered.ok && entered.alreadyThere !== true;
    }
    say(`keyloom: waiting for ${step.volume} (${step.label}, step ${i + 1} of ${input.steps.length})`);
    // A half keyloom restarted needs nothing from the person; its drive is already there.
    if (!restarted) input.onState("waiting_for_bootloader", instruction, { needsHand: true });
    allRestarted &&= byKeyloom;

    let mount: string | null = null;
    for (const deadline = Date.now() + waitMs; Date.now() < deadline; ) {
      if (signal?.aborted) {
        return failed(i === 0 ? "Cancelled. Nothing was flashed." : "Cancelled. The halves flashed so far keep the new firmware and the others keep the old; flash again to finish.");
      }
      mount = await input.findVolume(step.volume);
      if (mount) break;
      await sleep(poll, signal);
    }
    if (!mount) {
      return failed(
        `${step.volume} didn't appear within ${Math.round(waitMs / 1000)} s. ${i === 0 ? "Nothing was flashed." : `The ${input.steps[0]?.label} was flashed and the ${step.label} was not.`} Put the ${step.label} in bootloader mode and flash again.`,
      );
    }

    say(`keyloom: ${step.volume} is mounted at ${mount}; writing`);
    input.onState("writing", WRITING_INSTRUCTION);
    const target = join(mount, input.driveFileName ?? "glove80.uf2");
    try {
      // A boot drive macOS has only just mounted can refuse the first open with EACCES for a few seconds, then take the same write
      // (BK's Glove80 left half, 2026-10-16). Retry a refused open while the drive stays mounted; a lasting refusal is still reported.
      const retryUntil = Date.now() + (recovery ? 0 : input.writeRetryMs ?? WRITE_RETRY_MS);
      for (;;) {
        try {
          await (input.writeImage ?? writeFile)(target, image);
          break;
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if ((code !== "EACCES" && code !== "EPERM") || Date.now() >= retryUntil || !(await input.findVolume(step.volume))) throw err;
          say(`keyloom: ${step.volume} refused the write (${code}); trying again`);
          await sleep(poll, signal);
        }
      }
      // The write has to reach the drive before the bootloader looks at it.
      const handle = await open(target, "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (err) {
      // A bootloader that reboots as soon as the last block lands can take the drive away mid-close, which
      // shows up as a copy error; the drive being gone is still the bootloader's "written".
      const code = (err as NodeJS.ErrnoException).code;
      // A device-gone error can come while macOS still lists the drive, so give it a moment to unmount before calling it a failure
      // (BK's Glove80 left half, 2026-10-16: ENXIO on the write, and the half came back running the new build).
      if (code === "ENXIO" || code === "ENODEV" || code === "EIO") {
        const goneBy = Date.now() + (input.goneWaitMs ?? GONE_WAIT_MS);
        while (Date.now() < goneBy && (await input.findVolume(step.volume))) await sleep(poll, signal);
      }
      if (await input.findVolume(step.volume)) {
        // macOS refuses a write to a removable drive from an app without Removable Volumes access, and the raw EACCES doesn't say so.
        const denied = code === "EACCES" || code === "EPERM" ? ` keyloom wasn't allowed to write to the drive. On macOS, give the app running keyloom access to removable volumes in System Settings > Privacy & Security > Files & Folders, then flash again.` : "";
        return failed(`Copying to ${target} failed: ${(err as Error).message}. The ${step.label} was not flashed.${denied}`);
      }
      say(`keyloom: copy ended with "${(err as Error).message}", and ${step.volume} has unmounted, so the write is taken as done`);
    }

    const unmountBy = Date.now() + (input.unmountWaitMs ?? UNMOUNT_WAIT_MS);
    while (await input.findVolume(step.volume)) {
      if (Date.now() >= unmountBy || signal?.aborted) {
        return failed(`${step.volume} was still mounted ${Math.round((input.unmountWaitMs ?? UNMOUNT_WAIT_MS) / 1000)} s after the copy, so the bootloader didn't take the file. The ${step.label} was not flashed; try again.`);
      }
      await sleep(poll, signal);
    }
    say(`keyloom: ${step.volume} unmounted; the ${step.label} is flashed`);

    if (recovery || input.hooks?.verify) {
      say(`keyloom: waiting for the ${step.label} to come back`);
      input.onState("writing", `The ${step.label} is restarting. Don't unplug it; keyloom is checking it came back.`, { verifying: true });
      return recovery ? recovery.verify() : input.hooks!.verify!(step, i, image);
    }
    return { ok: true, message: `the ${step.label} was written` };
  };

  const restore: RestoreStep = (index, image, verify, instruction) => attempt(index, image, { verify, ...(instruction === undefined ? {} : { instruction }) });
  for (const [i] of input.steps.entries()) {
    let checked: VerifyResult;
    try {
      checked = await attempt(i, files[i] as Uint8Array);
    } catch (err) {
      checked = { ok: false, error: (err as Error).message };
    }
    if (!checked.ok) {
      const error = input.hooks?.recover ? await input.hooks.recover(i, checked.error, restore, say) : checked.error;
      return fail(error);
    }
    if (input.hooks?.verify) verified.push(checked.message);
  }
  await input.hooks?.complete?.();

  say(`keyloom: ${input.steps.map((s) => s.label).join(" and ")} flashed`);
  if (verified.length > 0) say(`keyloom: Verified: ${verified.join(", and ")}.`);
  input.onState("succeeded", null);
  return { state: "succeeded", error: null, output, handsFree: allRestarted && verified.length === input.steps.length };
}
