// Flashing by copying the UF2 to each half's boot drive (06#flash-copies-the-uf2-to-each-halfs-boot-drive, D-038).
// Each half's bootloader shows up as a USB drive. Writing a UF2 to it flashes the half, and the
// bootloader unmounts the drive itself when the write was good, so the drive disappearing is the
// success signal. Both halves take the same combined file; MoErgo says to do the right half first, and
// the board definition lists the steps in the order to run them.
import { copyFile, open } from "node:fs/promises";
import { join } from "node:path";
import type { FlashResult, FlashState } from "../toolchain/flash-state.ts";
import type { LogSink } from "../toolchain/run.ts";
import { describeUf2, inspectUf2, uf2Problem } from "./uf2.ts";
import type { VolumeFinder } from "./volumes.ts";

export const BOOTLOADER_WAIT_MS = 120_000;
export const UNMOUNT_WAIT_MS = 30_000;
export const POLL_MS = 500;

export const WRITING_INSTRUCTION = "Don't unplug or switch off the half. Writing takes a few seconds, and the drive disappears when it is done.";

export type FlashStep = { volume: string; label: string; enter: string };

export type Uf2FlashInput = {
  artifactPath: string;
  steps: readonly FlashStep[];
  /** Always passed in: tests give a finder over a temporary directory, so nothing here can reach a real keyboard by default. */
  findVolume: VolumeFinder;
  log: LogSink;
  /** Called on every state change; `instruction` is what the person must do now. */
  onState: (state: FlashState, instruction: string | null) => void;
  onLine?: (line: string) => void;
  bootloaderWaitMs?: number;
  unmountWaitMs?: number;
  pollMs?: number;
  signal?: AbortSignal;
};

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

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

  const file = Bun.file(input.artifactPath);
  if (!(await file.exists())) return fail(`${input.artifactPath} doesn't exist; build it again.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = uf2Problem(bytes);
  if (problem) return fail(`Not flashing: ${problem}.`);
  const info = inspectUf2(bytes);
  if (!("problem" in info)) say(`keyloom: ${input.artifactPath} is ${describeUf2(info)}`);

  for (const [i, step] of input.steps.entries()) {
    const instruction = instructionFor(step, i, input.steps.length, waitMs);
    say(`keyloom: waiting for ${step.volume} (${step.label}, step ${i + 1} of ${input.steps.length})`);
    input.onState("waiting_for_bootloader", instruction);

    let mount: string | null = null;
    for (const deadline = Date.now() + waitMs; Date.now() < deadline; ) {
      if (input.signal?.aborted) {
        return fail(i === 0 ? "Cancelled. Nothing was flashed." : "Cancelled. The halves flashed so far keep the new firmware and the others keep the old; flash again to finish.");
      }
      mount = await input.findVolume(step.volume);
      if (mount) break;
      await sleep(poll, input.signal);
    }
    if (!mount) {
      return fail(
        `${step.volume} didn't appear within ${Math.round(waitMs / 1000)} s. ${i === 0 ? "Nothing was flashed." : `The ${input.steps[0]?.label} was flashed and the ${step.label} was not.`} Put the ${step.label} in bootloader mode and flash again.`,
      );
    }

    say(`keyloom: ${step.volume} is mounted at ${mount}; writing`);
    input.onState("writing", WRITING_INSTRUCTION);
    const target = join(mount, "glove80.uf2");
    try {
      await copyFile(input.artifactPath, target);
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
      if (await input.findVolume(step.volume)) return fail(`Copying to ${target} failed: ${(err as Error).message}. The ${step.label} was not flashed.`);
      say(`keyloom: copy ended with "${(err as Error).message}", and ${step.volume} has unmounted, so the write is taken as done`);
    }

    const unmountBy = Date.now() + (input.unmountWaitMs ?? UNMOUNT_WAIT_MS);
    while (await input.findVolume(step.volume)) {
      if (Date.now() >= unmountBy || input.signal?.aborted) {
        return fail(`${step.volume} was still mounted ${Math.round((input.unmountWaitMs ?? UNMOUNT_WAIT_MS) / 1000)} s after the copy, so the bootloader didn't take the file. The ${step.label} was not flashed; try again.`);
      }
      await sleep(poll, input.signal);
    }
    say(`keyloom: ${step.volume} unmounted; the ${step.label} is flashed`);
  }

  say(`keyloom: ${input.steps.map((s) => s.label).join(" and ")} flashed`);
  input.onState("succeeded", null);
  return { state: "succeeded", error: null, output };
}
