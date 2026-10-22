// The host half of hands-free flashing on ZMK (D-095): read which keyloom build each half runs from its USB
// serial number, restart a half into its UF2 bootloader by closing its serial port at 1200 baud (or, for a
// peripheral with no port of its own, asking the central to relay it at 1201), and after the flash check the
// half came back running the new build. Serial ports, USB and volumes are parameters, so tests use fakes and
// never touch a keyboard. Mirrors src/firmware/qmk/handsfree-flash.ts (D-070 to D-074).
import type { HandsFree, HandsFreeHalf } from "../../boards/recipes.ts";
import type { BoardDefinition } from "../../boards/schema.ts";
import { defaultSerialTransport } from "../toolchain/serial-default.ts";
import type { SerialPort, SerialTransport } from "../toolchain/serial.ts";
import { type UsbDevice, listUsbDevices } from "../toolchain/usb.ts";
import type { EnterResult, FlashStep, StepHooks, VerifyResult } from "./flash.ts";
import { type HalfLetter, LOCAL_BAUD, RELAY_BAUD, buildKey, halfMarker, keyInArtifact, parseSerial } from "./handsfree.ts";
import type { VolumeFinder } from "./volumes.ts";

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
}): Promise<EnterResult> {
  const { deps, target: t, log } = opts;
  const label = t.step.label;
  const poll = deps.pollMs ?? 500;
  const waitMs = deps.restartWaitMs ?? RESTART_WAIT_MS;

  try {
    // A drive that is already there is a half already in its bootloader, which is where this is trying to get it.
    if (opts.waitForVolume !== false && await opts.findVolume(t.step.volume)) {
      log(`keyloom: ${t.step.volume} is already mounted, so the ${label} is already in its bootloader`);
      return { ok: true, alreadyThere: true };
    }

    const transport = await deps.serial();
    const ports = await transport.list();
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

    opts.announce?.(`keyloom is restarting the ${label} into its bootloader. Don't touch the keyboard.`);
    await transport.touch(touched.path, touched.baud);
    if (opts.waitForVolume === false) return { ok: true };

    const deadline = Date.now() + waitMs;
    for (;;) {
      if (await opts.findVolume(t.step.volume)) {
        log(`keyloom: ${t.step.volume} appeared; the ${label} is in its bootloader`);
        return { ok: true };
      }
      if (Date.now() >= deadline) break;
      await sleep(poll);
    }
    // A relayed peripheral with no cable of its own goes back to its app after 3 s, which looks the same from here.
    const cable = touched.baud === RELAY_BAUD ? ` Is the ${label}'s own USB cable plugged in? A half on battery returns to typing after 3 seconds.` : "";
    return { ok: false, reason: `${t.step.volume} didn't appear within ${Math.round(waitMs / 1000)} seconds of restarting the ${label}.${cable}` };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

/** After a flash: the half must come back running `buildId`'s firmware. */
export async function verifyHalf(opts: { deps: ZmkHandsFreeDeps; target: HalfTarget; buildId: string; log: (line: string) => void }): Promise<VerifyResult> {
  const { deps, target: t } = opts;
  const label = t.step.label;
  const expected = halfMarker(opts.buildId, t.half.marker);
  const key = buildKey(opts.buildId);
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
    if (seen.state === "keyloom" && seen.key === key) return { ok: true, message: `the ${label} is running build ${opts.buildId}` };
    // A half comes back on USB a moment before its serial port does, so it can first show only as a USB device. Its serial number
    // already names the build it runs: this build is a pass, and another keyloom build may still be its port coming up, so wait.
    // (BK's Glove80, 2026-10-16: the right half was flashed and verified as "not running this build" from its USB device.)
    const usbMarker = seen.state === "other" ? parseSerial(seen.serial) : undefined;
    if (usbMarker !== undefined && usbMarker.half === t.half.marker && usbMarker.key === key) return { ok: true, message: `the ${label} is running build ${opts.buildId}` };
    // A half that is back running something else won't change by waiting longer.
    if (seen.state !== "absent" && usbMarker === undefined) break;
    if (Date.now() >= deadline) break;
    await sleep(poll);
  }
  opts.log(`keyloom: after the flash the ${label} reports ${seen.state === "absent" ? "nothing" : seen.state === "keyloom" ? `build ${seen.key}` : `serial ${seen.serial ?? "(none)"}`}; expected ${expected}`);
  if (seen.state === "absent") {
    // The copy can be cut short when the bootloader's drive disappears mid-write, and a half with incomplete firmware never
    // comes back on USB (BK's Glove80 left half, 2026-10-22: the rewrite from its bootloader then verified). Lead with that remedy.
    return { ok: false, error: `the ${label} was written, but it didn't come back within ${Math.round(waitMs / 1000)} seconds, so keyloom couldn't confirm the flash. Its firmware may be incomplete. Put it in its bootloader and flash again: ${t.step.enter} If it doesn't appear even then, check its USB cable and run \`keyloom doctor\`.` };
  }
  if (seen.state === "keyloom") {
    return { ok: false, error: `the ${label} was written, but it is running build ${seen.key} and not ${opts.buildId} (${expected}). The flash may not have been written; flash again.` };
  }
  return { ok: false, error: `the ${label} was written, but it came back with ${seen.serial ?? "no serial number"} and not ${expected}, so it isn't running this build. Flash again.` };
}

/**
 * What a ZMK flash adds when the board carries keyloom's module: restarting each half by itself where it can, and
 * verifying each half if the file being written is a keyloom build. `saveLastGood` keeps the image of a verified half.
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
  foreign?: (port: SerialPort) => boolean;
  saveLastGood?: (half: HalfLetter, image: Uint8Array) => Promise<void>;
}): StepHooks {
  const targets = halfTargets(input.board, input.handsFree, input.steps, input.foreign);
  const forStep = (step: FlashStep): HalfTarget | undefined => targets.find((t) => t.step === step);
  const hooks: StepHooks = {
    enterBootloader: async (step, _index, announce) => {
      const target = forStep(step);
      return target ? restartHalf({ deps: input.deps, targets, target, findVolume: input.findVolume, log: input.log, announce }) : { ok: false, reason: "keyloom has no hands-free recipe for this step" };
    },
  };

  let key: string | undefined;
  try {
    key = buildKey(input.buildId);
  } catch {
    // Not a build ID keyloom made, so no firmware can carry its marker.
  }
  if (key !== undefined && keyInArtifact(input.artifact) === key) {
    hooks.verify = async (step, _index, image) => {
      const target = forStep(step);
      if (!target) return { ok: true, message: `the ${step.label} was written` };
      const result = await verifyHalf({ deps: input.deps, target, buildId: input.buildId, log: input.log });
      if (result.ok) {
        try {
          await input.saveLastGood?.(target.half.marker, image);
        } catch (err) {
          input.log(`keyloom: couldn't keep the ${step.label}'s image as the last good one: ${(err as Error).message}`);
        }
      }
      return result;
    };
  } else {
    input.log("keyloom: this build was made before hands-free flashing, so the flash can't be verified from the halves' serial numbers");
  }
  return hooks;
}
