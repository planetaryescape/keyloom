// The host half of hands-free flashing on ZMK (D-095): read which keyloom build each half runs from its USB
// serial number, restart a half into its UF2 bootloader by closing its serial port at 1200 baud (or, for a
// peripheral with no port of its own, asking the central to relay it at 1201), and after the flash check the
// half came back running the new build. Serial ports, USB and volumes are parameters, so tests use fakes and
// never touch a keyboard. Mirrors src/firmware/qmk/handsfree-flash.ts (D-070 to D-074).
import type { HandsFree, HandsFreeHalf } from "../../boards/recipes.ts";
import type { BoardDefinition } from "../../boards/schema.ts";
import { defaultSerialTransport } from "../toolchain/serial-default.ts";
import type { SerialPort, SerialTransport } from "../toolchain/serial.ts";
import { uf2Problem } from "../toolchain/uf2.ts";
import { type UsbDevice, listUsbDevices } from "../toolchain/usb.ts";
import type { EnterResult, FlashStep, StepHooks, VerifyResult } from "./flash.ts";
import { retryRemedy, sharedDriveRemedy } from "./flash.ts";
import { type HalfLetter, LOCAL_BAUD, RELAY_BAUD, buildKey, halfMarker, keyInArtifact, keyInFirmware, parseSerial } from "./handsfree.ts";
import type { VolumeFinder } from "./volumes.ts";
import { SCREEN_LOCK_MESSAGE } from "../toolchain/screen-lock.ts";

export type ZmkHandsFreeDeps = {
  serial: () => Promise<SerialTransport>;
  /** Only the doctor reads this: a half that runs older firmware has no serial port, so USB is the only way to see it. */
  usb: () => Promise<UsbDevice[]>;
  /** Polling pause; tests pass a short one. */
  pollMs?: number;
  /** How long a half has to show its boot drive after it is restarted (default 15 s). */
  restartWaitMs?: number;
  /** How long a flashed half has to come back with the new marker (default 45 s). */
  verifyWaitMs?: number;
};

export const realZmkHandsFreeDeps = (over: Partial<ZmkHandsFreeDeps> = {}): ZmkHandsFreeDeps => ({ serial: defaultSerialTransport, usb: listUsbDevices, ...over });

export const RESTART_WAIT_MS = 15_000;
export const VERIFY_WAIT_MS = 45_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const hexId = (n: number): string => `0x${n.toString(16).padStart(4, "0")}`;

/** A half of a board, with the flash step that writes it. */
export type HalfTarget = {
  half: HandsFreeHalf;
  step: FlashStep;
  boardName: string;
  vendorId: string | undefined;
  /** Ports that belong to another board keyloom knows by USB ID. A board with no IDs of its own would otherwise take any port that carries a marker with its half's letter. */
  foreign?: (port: SerialPort) => boolean;
};

/** The halves a board's flash recipe names, each with its step, in the board's flashing order. */
export function halfTargets(board: BoardDefinition, handsFree: HandsFree, steps: readonly FlashStep[], foreign?: (port: SerialPort) => boolean): HalfTarget[] {
  return steps.flatMap((step) => {
    const half = handsFree.halves.find((h) => h.step === step.label);
    return half ? [{ half, step, boardName: board.name, vendorId: handsFree.usbVendorId, ...(foreign ? { foreign } : {}) }] : [];
  });
}

export const matchesHalfIds = (p: SerialPort, t: HalfTarget): boolean =>
  t.foreign?.(p) !== true &&
  (t.vendorId === undefined || hexId(p.vendorId) === t.vendorId.toLowerCase()) &&
  (t.half.usbProductId === undefined || hexId(p.productId) === t.half.usbProductId.toLowerCase());

/**
 * The ports that are this half. A port with keyloom's marker and this half's letter is a keyloom port, whatever the
 * board. A port without a marker is "other firmware" only when the half's product ID says it is this half's: a board
 * without known IDs (the Corne) can't tell its own port from any other serial device.
 */
export function portsOfHalf(ports: SerialPort[], t: HalfTarget): { keyloom: Array<{ port: SerialPort; key: string }>; other: SerialPort[] } {
  const keyloom: Array<{ port: SerialPort; key: string }> = [];
  const other: SerialPort[] = [];
  for (const port of ports) {
    if (port.driverMissing || !matchesHalfIds(port, t)) continue;
    const parsed = parseSerial(port.serial);
    if (parsed) {
      if (parsed.half === t.half.marker) keyloom.push({ port, key: parsed.key });
    } else if (t.half.usbProductId !== undefined) {
      other.push(port);
    }
  }
  return { keyloom, other };
}

export type HalfFirmware = { state: "absent" } | { state: "other"; serial: string | undefined } | { state: "keyloom"; key: string; path: string };

/** What one half is running, from the serial ports and, where the half's product ID is known, from USB. */
export async function readHalf(deps: ZmkHandsFreeDeps, t: HalfTarget, ports?: SerialPort[]): Promise<HalfFirmware> {
  const list = ports ?? (await (await deps.serial()).list());
  const { keyloom, other } = portsOfHalf(list, t);
  const first = keyloom[0];
  if (first) return { state: "keyloom", key: first.key, path: first.port.path };
  const port = other[0];
  if (port) return { state: "other", serial: port.serial };
  // Firmware from before keyloom's module has no serial port; USB still shows the half by its product ID.
  if (t.half.usbProductId !== undefined) {
    const device = (await deps.usb()).find((d) => d.productId === t.half.usbProductId?.toLowerCase() && (t.vendorId === undefined || d.vendorId === t.vendorId.toLowerCase()));
    if (device) return { state: "other", serial: device.serial };
  }
  return { state: "absent" };
}

/**
 * Restarts one half into its bootloader and waits for its boot drive. Never throws: every way it can fail is a reason,
 * and the caller falls back to asking for the key combo with that reason.
 */
export async function restartHalf(opts: {
  deps: ZmkHandsFreeDeps;
  targets: readonly HalfTarget[];
  target: HalfTarget;
  findVolume: VolumeFinder;
  /** Reboot-only can report transport acceptance without probing/copying to a UF2 drive. */
  waitForVolume?: boolean;
  log: (line: string) => void;
  announce?: (instruction: string) => void;
  screenLocked?: (() => Promise<boolean>) | undefined;
}): Promise<EnterResult> {
  const { deps, target: t, log } = opts;
  const label = t.step.label;
  const poll = deps.pollMs ?? 500;
  const waitMs = deps.restartWaitMs ?? RESTART_WAIT_MS;

  try {
    // Only a distinct label identifies a half that is already in its bootloader.
    if (opts.waitForVolume !== false && await opts.findVolume(t.step.volume)) {
      if (opts.targets.some((other) => other !== t && other.step.volume === t.step.volume)) {
        return { ok: false, reason: `${t.step.volume} is already mounted and could belong to either half` };
      }
      log(`keyloom: ${t.step.volume} is already mounted, so the ${label} is already in its bootloader`);
      return { ok: true, alreadyThere: true };
    }

    const transport = await deps.serial();
    const ports = await transport.list();
    const peers = opts.targets.filter((other) => other !== t && other.step.volume === t.step.volume);
    if (opts.waitForVolume !== false && peers.some((other) => portsOfHalf(ports, other).keyloom.length !== 1)) {
      return { ok: false, reason: `${t.step.volume} could belong to either half; keyloom cannot confirm the other half is running firmware` };
    }
    const own = portsOfHalf(ports, t);
    const keys = new Set(own.keyloom.map((k) => k.key));
    if (own.keyloom.length > 1 && (keys.size > 1 || new Set(own.keyloom.map((k) => k.port.path)).size > 1)) {
      return { ok: false, reason: `more than one ${t.boardName} ${label} is attached (${own.keyloom.map((k) => k.port.path).join(", ")}); unplug the others` };
    }
    const mine = own.keyloom[0];
    let touched: { path: string; baud: number };
    if (mine) {
      log(`keyloom: the ${label} runs keyloom build ${mine.key}; closing ${mine.port.path} at ${LOCAL_BAUD} baud restarts it into its bootloader`);
      touched = { path: mine.port.path, baud: LOCAL_BAUD };
    } else {
      const central = opts.targets.find((x) => x.half.role === "central");
      const via = t.half.relay && central ? portsOfHalf(ports, central).keyloom : [];
      if (via.length === 0 || !central) {
        const seen = own.other.length > 0 ? `it is running firmware keyloom didn't build (USB serial ${own.other[0]?.serial ?? "unavailable"})` : `no keyloom serial port was found for it`;
        return { ok: false, reason: `${seen}, so it needs its bootloader key this once` };
      }
      if (via.length > 1) return { ok: false, reason: `more than one ${t.boardName} ${central.step.label} is attached (${via.map((k) => k.port.path).join(", ")}); unplug the others` };
      const relay = via[0] as { port: SerialPort; key: string };
      log(`keyloom: the ${label} has no serial port of its own; closing the ${central.step.label}'s ${relay.port.path} at ${RELAY_BAUD} baud asks it to restart the ${label} over the split link`);
      touched = { path: relay.port.path, baud: RELAY_BAUD };
    }

    if (opts.screenLocked) {
      try {
        if (await opts.screenLocked()) return { ok: false, reason: SCREEN_LOCK_MESSAGE };
      } catch {
        // The outer flash probe logs failures and fails open.
      }
    }
    opts.announce?.(`keyloom is restarting the ${label} into its bootloader. Don't touch the keyboard.`);
    await transport.touch(touched.path, touched.baud);
    if (opts.waitForVolume === false) return { ok: true };

    const deadline = Date.now() + waitMs;
    let lockWasReported = false;
    for (;;) {
      if (await opts.findVolume(t.step.volume)) {
        const after = peers.length ? await transport.list() : [];
        if (peers.some((other) => portsOfHalf(after, other).keyloom.length !== 1)) {
          return { ok: false, reason: `${t.step.volume} could belong to either half; the other half is no longer confirmed running firmware` };
        }
        log(`keyloom: ${t.step.volume} appeared; the ${label} is in its bootloader`);
        return { ok: true };
      }
      if (opts.screenLocked) {
        let locked = false;
        try { locked = await opts.screenLocked(); } catch { /* The outer probe logs failures and fails open. */ }
        if (locked !== lockWasReported) {
          lockWasReported = locked;
          opts.announce?.(locked ? SCREEN_LOCK_MESSAGE : `keyloom is restarting the ${label} into its bootloader. Don't touch the keyboard.`);
        }
      }
      if (Date.now() >= deadline) break;
      await sleep(poll);
    }
    if (!lockWasReported && opts.screenLocked) {
      try { lockWasReported = await opts.screenLocked(); } catch { /* The outer probe logs failures and fails open. */ }
    }
    if (lockWasReported) return { ok: false, reason: SCREEN_LOCK_MESSAGE };
    // A relayed peripheral with no cable of its own goes back to its app after 3 s, which looks the same from here.
    const cable = touched.baud === RELAY_BAUD ? ` Is the ${label}'s own USB cable plugged in? A half on battery returns to typing after 3 seconds.` : "";
    return { ok: false, reason: `${t.step.volume} didn't appear within ${Math.round(waitMs / 1000)} seconds of restarting the ${label}.${cable}` };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

/** After a flash: the half must come back with the new build ID's key, or a saved image's key during rollback. */
export async function verifyHalf(opts: { deps: ZmkHandsFreeDeps; target: HalfTarget; steps?: readonly FlashStep[]; log: (line: string) => void } & ({ buildId: string; key?: never } | { key: string; buildId?: never })): Promise<VerifyResult> {
  const { deps, target: t } = opts;
  const label = t.step.label;
  const key = opts.key ?? buildKey(opts.buildId);
  const build = opts.buildId ?? key;
  const expected = opts.buildId === undefined ? `keyloom/${key}-${t.half.marker}` : halfMarker(opts.buildId, t.half.marker);
  const waitMs = deps.verifyWaitMs ?? VERIFY_WAIT_MS;
  const poll = deps.pollMs ?? 1000;
  const deadline = Date.now() + waitMs;
  let seen: HalfFirmware = { state: "absent" };
  for (;;) {
    try {
      seen = await readHalf(deps, t);
    } catch {
      // Retried until the deadline, like a half that has not appeared yet.
    }
    if (seen.state === "keyloom" && seen.key === key) return { ok: true, message: `the ${label} is running build ${build}` };
    // A half comes back on USB a moment before its serial port does, so it can first show only as a USB device. Its serial number
    // already names the build it runs: this build is a pass, and another keyloom build may still be its port coming up, so wait.
    // (BK's Glove80, 2026-10-16: the right half was flashed and verified as "not running this build" from its USB device.)
    const usbMarker = seen.state === "other" ? parseSerial(seen.serial) : undefined;
    if (usbMarker !== undefined && usbMarker.half === t.half.marker && usbMarker.key === key) return { ok: true, message: `the ${label} is running build ${build}` };
    // A half that is back running something else won't change by waiting longer.
    if (seen.state !== "absent" && usbMarker === undefined) break;
    if (Date.now() >= deadline) break;
    await sleep(poll);
  }
  opts.log(`keyloom: after the flash the ${label} reports ${seen.state === "absent" ? "nothing" : seen.state === "keyloom" ? `build ${seen.key}` : `serial ${seen.serial ?? "(none)"}`}; expected ${expected}`);
  if (seen.state === "absent") {
    // The copy can be cut short when the bootloader's drive disappears mid-write, and a half with incomplete firmware never
    // comes back on USB (BK's Glove80 left half, 2026-10-22: the rewrite from its bootloader then verified). Lead with that remedy.
    const remedy = opts.steps?.some((step) => step !== t.step && step.volume === t.step.volume)
      ? sharedDriveRemedy(t.step, opts.steps)
      : opts.steps ? `${retryRemedy(opts.steps)} To recover the ${label} on its own, connect only that half and put it in its bootloader: ${t.step.enter}`
      : `Put it in its bootloader and flash again: ${t.step.enter}`;
    return { ok: false, error: `the ${label} was written, but it didn't come back within ${Math.round(waitMs / 1000)} seconds, so keyloom couldn't confirm the flash. Its firmware may be incomplete. ${remedy} If it doesn't appear even then, check its USB cable and run \`keyloom doctor\`.` };
  }
  if (seen.state === "keyloom") {
    return { ok: false, error: `the ${label} was written, but it is running build ${seen.key} and not ${build} (${expected}). The flash may not have been written; flash again.` };
  }
  return { ok: false, error: `the ${label} was written, but it came back with ${seen.serial ?? "no serial number"} and not ${expected}, so it isn't running this build. Flash again.` };
}

/**
 * What a ZMK flash adds when the board carries keyloom's module: restarting each half by itself where it can, and
 * verifying each half if the file being written is a keyloom build. Last-good images change only after all halves verify.
 */
export function zmkHandsFreeHooks(input: {
  deps: ZmkHandsFreeDeps;
  board: BoardDefinition;
  handsFree: HandsFree;
  steps: readonly FlashStep[];
  artifact: Uint8Array;
  buildId: string;
  findVolume: VolumeFinder;
  log: (line: string) => void;
  screenLocked?: (() => Promise<boolean>) | undefined;
  foreign?: (port: SerialPort) => boolean;
  /** Promotes every half's verified image as one set; the previous set must survive any failure (D-437). */
  saveLastGood?: (images: ReadonlyMap<HalfLetter, Uint8Array>) => Promise<void>;
  loadLastGood?: (half: HalfLetter) => Promise<Uint8Array | null>;
}): StepHooks {
  const verifyDeps = { ...input.deps, verifyWaitMs: input.deps.verifyWaitMs ?? input.handsFree.verifyWaitMs ?? VERIFY_WAIT_MS };
  const targets = halfTargets(input.board, input.handsFree, input.steps, input.foreign);
  const forStep = (step: FlashStep): HalfTarget | undefined => targets.find((t) => t.step === step);
  const before = new Map<HalfTarget, HalfFirmware>();
  const hooks: StepHooks = {
    peersRunning: async (step) => {
      const peers = input.steps.filter((other) => other !== step && other.volume === step.volume);
      try {
        const states = await Promise.all(peers.map(async (peer) => {
          const target = forStep(peer);
          return target ? readHalf(input.deps, target) : { state: "absent" as const };
        }));
        return states.every((state) => state.state !== "absent");
      } catch {
        return false;
      }
    },
    enterBootloader: async (step, _index, announce) => {
      const target = forStep(step);
      if (target) {
        try { before.set(target, await readHalf(input.deps, target)); } catch { /* Recovery treats an unreadable half as unknown. */ }
      }
      return target ? restartHalf({ deps: input.deps, targets, target, findVolume: input.findVolume, log: input.log, announce, screenLocked: input.screenLocked }) : { ok: false, reason: "keyloom has no hands-free recipe for this step" };
    },
  };

  let key: string | undefined;
  try {
    key = buildKey(input.buildId);
  } catch {
    // Not a build ID keyloom made, so no firmware can carry its marker.
  }
  if (key !== undefined && keyInArtifact(input.artifact) === key) {
    const images = new Map<HalfTarget, Uint8Array>();
    hooks.verify = async (step, _index, image) => {
      const target = forStep(step);
      // The recipe schema requires every step to map to a half; never report an unmapped one as verified.
      if (!target) return { ok: false, error: `the ${step.label} was written, but its recipe has no hands-free half to verify it against` };
      const result = await verifyHalf({ deps: verifyDeps, target, steps: input.steps, buildId: input.buildId, log: input.log });
      if (result.ok) images.set(target, image);
      return result;
    };
    hooks.complete = async () => {
      if (images.size !== input.steps.length) return;
      try {
        await input.saveLastGood?.(new Map([...images].map(([target, image]) => [target.half.marker, image])));
      } catch (err) {
        // The keyboard runs the new build either way; only a later rollback is affected, and it keeps the previous set.
        input.log(`keyloom: couldn't keep this build as the last good one: ${(err as Error).message}`);
      }
    };
    hooks.recover = async (index, error, restore, say) => {
      if (index === 0 || images.size === 0 || targets.length !== input.steps.length) return error;
      const failed = targets[index] as HalfTarget;
      const observedKey = (state: HalfFirmware | undefined, target: HalfTarget): string | undefined => {
        if (state?.state === "keyloom") return state.key;
        const marker = state?.state === "other" ? parseSerial(state.serial) : undefined;
        return marker?.half === target.half.marker ? marker.key : undefined;
      };
      const current = async (target: HalfTarget): Promise<HalfFirmware | undefined> => {
        try { return await readHalf(input.deps, target); } catch { return undefined; }
      };
      const summary = async (snapshot?: Array<HalfFirmware | undefined>): Promise<string> => {
        const reading = snapshot ?? await Promise.all(targets.map(current));
        const states = reading.map((state, i) => {
          const t = targets[i] as HalfTarget;
          const key = observedKey(state, t);
          return `the ${t.step.label} ${key ? `is running build ${key}` : state?.state === "absent" ? "is absent or in its bootloader" : state?.state === "other" ? `reports firmware with serial ${state.serial ?? "(none)"}` : "could not be read"}`;
        });
        return `${states.join(", and ")}.`;
      };
      const shared = targets.some((t) => t !== failed && t.step.volume === failed.step.volume);
      const remedy = shared ? sharedDriveRemedy(failed.step, input.steps) : retryRemedy(input.steps);
      const stopped = async (reason: string, includeRemedy = true) => `${error} ${reason} ${await summary()}${includeRemedy ? ` ${remedy}` : ""}`;
      // Read before touching a rollback target: the failed half may still run its previous build.
      const failedState = await current(failed);
      const previous = new Map<HalfTarget, { image: Uint8Array; key: string }>();
      const shape = input.artifact[0] === 0x50 && input.artifact[1] === 0x4b ? "single" : "halves";
      for (const t of images.keys()) {
        let image: Uint8Array | null;
        try { image = await input.loadLastGood?.(t.half.marker) ?? null; }
        catch (err) { return stopped(`Rollback couldn't read the ${t.step.label}'s last-good image: ${(err as Error).message}.`); }
        const key = image ? keyInFirmware(image) : undefined;
        if (!image || !key) return stopped(`Rollback is unavailable: no verified last-good image for the ${t.step.label}.`);
        const problem = uf2Problem(image, shape);
        if (problem) return stopped(`Rollback is unavailable: the ${t.step.label}'s last-good image is unsafe: ${problem}.`);
        const old = observedKey(before.get(t), t);
        if (old !== undefined && old !== key) return stopped(`Rollback is unavailable: the ${t.step.label}'s last-good image is build ${key}, but it ran build ${old} before the flash.`);
        previous.set(t, { image, key });
      }
      const oldKey = previous.values().next().value!.key;
      if ([...previous.values()].some((p) => p.key !== oldKey)) return stopped("Rollback is unavailable: the saved halves have different build keys.");
      const neverWritten = observedKey(failedState, failed) === oldKey;
      let failedImageProblem: string | undefined;
      if (!neverWritten) {
        let image: Uint8Array | null = null;
        try { image = await input.loadLastGood?.(failed.half.marker) ?? null; }
        catch (err) { failedImageProblem = `couldn't read the ${failed.step.label}'s last-good image: ${(err as Error).message}`; }
        const key = image ? keyInFirmware(image) : undefined;
        // Restore the verified halves even when the failed half has no usable saved image.
        const problem = image ? uf2Problem(image, shape) : undefined;
        const old = observedKey(before.get(failed), failed);
        if (key !== undefined && old !== undefined && key !== old) failedImageProblem = `the ${failed.step.label}'s last-good image is build ${key}, but it ran build ${old} before the flash`;
        else if (image && key === oldKey && !problem) previous.set(failed, { image, key });
        else failedImageProblem ??= problem ? `the ${failed.step.label}'s last-good image is unsafe: ${problem}` : `no last-good image of build ${oldKey} for the ${failed.step.label}`;
      }
      for (const [t, saved] of previous) {
        let result: VerifyResult;
        try {
          say(`keyloom: Rolling back the ${t.step.label} to build ${saved.key}.`);
          result = await restore(input.steps.indexOf(t.step), saved.image,
            () => verifyHalf({ deps: verifyDeps, target: t, steps: input.steps, key: saved.key, log: say }),
            t === failed ? `Restore the ${t.step.label} to build ${saved.key}. ${t.step.enter}` : undefined);
        } catch (err) { result = { ok: false, error: (err as Error).message }; }
        if (!result.ok) return stopped(`Rollback of the ${t.step.label} failed: ${result.error}${shared ? "" : ` Put the ${t.step.label} in its bootloader to restore it: ${t.step.enter}`}`, !shared);
        say(`keyloom: Rollback verified: ${result.message}.`);
      }
      if (failedImageProblem) return stopped(`Rollback is incomplete: ${failedImageProblem}.`);
      // Read every half again after restoring: a successful write alone is not proof of the final board state.
      const final = await Promise.all(targets.map(current));
      if (!final.every((s, i) => observedKey(s, targets[i] as HalfTarget) === oldKey)) return stopped("Rollback could not confirm every half on the previous build.");
      return `${error} The keyboard is back on the previous build ${oldKey}. Rollback verified: ${await summary(final)} The new build was not applied; flash again when ready.`;
    };
  } else {
    input.log("keyloom: this build was made before hands-free flashing, so the flash can't be verified from the halves' serial numbers");
  }
  return hooks;
}
