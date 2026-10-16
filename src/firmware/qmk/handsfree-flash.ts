// The host half of hands-free flashing (D-070, D-071): read which firmware the keyboard is running
// from its USB serial number, send the bootloader command over raw HID, and after a flash check the
// keyboard came back running the new build. USB and HID are parameters, so tests use fakes and never
// touch a keyboard.
import type { BoardDefinition } from "../../boards/schema.ts";
import { type HidTransport, type RawHidInterface } from "../toolchain/hid.ts";
import { defaultHidTransport } from "../toolchain/hid-default.ts";
import type { LogSink } from "../toolchain/run.ts";
import { type UsbDevice, listUsbDevices } from "../toolchain/usb.ts";
import type { QmkBoardRevision } from "./board-config.ts";
import type { FlashInput } from "./flash.ts";
import { ZSA_VENDOR_ID, bootloaderPacket, buildMarker, markerInFirmware, markerOf } from "./handsfree.ts";

export type HandsFreeDeps = {
  usb: () => Promise<UsbDevice[]>;
  hid: () => Promise<HidTransport>;
  /** Polling pause; tests pass a short one. */
  pollMs?: number;
};

/** The keyboard being flashed, as USB sees it while its firmware runs and while its bootloader does. */
export type KeyboardTarget = {
  /** `0x1969`, lower case. */
  productId: string;
  /** `0x3297`, lower case; ZSA's when a target leaves it out, which every target written before D-237 did. */
  vendorId?: string;
  /** `0483:df11`, as boards' flash recipes spell it. */
  bootloader: string;
  name: string;
};

export type RunningFirmware =
  | { state: "absent" }
  | { state: "other"; serial: string | undefined }
  | { state: "keyloom"; serial: string };

const hexId = (n: number): string => `0x${n.toString(16).padStart(4, "0")}`;

/** Which USB device a board is, by the ids its running firmware reports. Any QMK board with ids can be seen; only a ZSA board can also be restarted (D-237). */
export type KeyboardIdentity = Required<Pick<KeyboardTarget, "vendorId">> & Pick<KeyboardTarget, "productId" | "name">;

const isKeyboard = (d: UsbDevice, t: Pick<KeyboardTarget, "vendorId" | "productId">): boolean => d.vendorId === (t.vendorId ?? hexId(ZSA_VENDOR_ID)) && d.productId === t.productId;

export const inBootloader = (devices: UsbDevice[], t: KeyboardTarget): boolean => {
  const [vendor, product] = t.bootloader.split(":");
  return devices.some((d) => d.vendorId === `0x${vendor}` && d.productId === `0x${product}`);
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What the keyboard's USB serial says about its firmware. */
export async function readRunningFirmware(deps: HandsFreeDeps, target: Pick<KeyboardTarget, "vendorId" | "productId">): Promise<RunningFirmware> {
  const device = (await deps.usb()).find((d) => isKeyboard(d, target));
  if (!device) return { state: "absent" };
  const marker = markerOf(device.serial);
  return marker ? { state: "keyloom", serial: marker } : { state: "other", serial: device.serial };
}

export type RebootResult = { ok: true } | { ok: false; reason: string };

export const REBOOT_WAIT_MS = 15_000;
const WRITE_ERROR_WAIT_MS = 4_000;

/**
 * Sends the bootloader command to a keyboard that is running keyloom's firmware, then waits for the
 * bootloader to appear on USB. A write error is not conclusive: the keyboard can reset before the OS
 * reports the write done, so the bootloader appearing is the only proof either way.
 */
const HID_LOOKUP_TRIES = 5;
const HID_LOOKUP_GAP_MS = 400;

export async function rebootToBootloader(
  deps: HandsFreeDeps,
  target: KeyboardTarget,
  log: (line: string) => void,
  waitMs = REBOOT_WAIT_MS,
): Promise<RebootResult> {
  let firmware: RunningFirmware;
  try {
    firmware = await readRunningFirmware(deps, target);
  } catch (err) {
    return { ok: false, reason: `couldn't read the USB devices: ${(err as Error).message}` };
  }
  if (firmware.state === "absent") return { ok: false, reason: `no ${target.name} is attached` };
  if (firmware.state === "other") {
    return { ok: false, reason: `the ${target.name} is running firmware keyloom didn't build (USB serial ${firmware.serial ?? "unavailable"}), which has no bootloader command` };
  }

  let transport: HidTransport;
  let iface: RawHidInterface | undefined;
  let seen: RawHidInterface[] = [];
  try {
    transport = await deps.hid();
    // On BK's Moonlander one lookup in three missed the interface that the next one found (2026-10-15),
    // so a miss is retried briefly before keyloom falls back to asking for the key.
    for (let attempt = 0; attempt < HID_LOOKUP_TRIES; attempt++) {
      if (attempt > 0) await Bun.sleep(deps.pollMs ?? HID_LOOKUP_GAP_MS);
      seen = await transport.list();
      iface = seen.find((h) => h.vendorId === ZSA_VENDOR_ID && hexId(h.productId) === target.productId && (h.serial === undefined || h.serial === firmware.serial));
      if (iface) break;
    }
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  if (!iface) {
    // Said in full, so an intermittent miss on real hardware shows what the lookup saw instead of a guess.
    const zsa = seen.filter((h) => h.vendorId === ZSA_VENDOR_ID).map((h) => `${hexId(h.productId)} serial ${h.serial ?? "none"}`);
    const saw = zsa.length === 0 ? `no ZSA raw HID interface among ${seen.length}` : `only ${zsa.join(", ")}`;
    return { ok: false, reason: `the ${target.name}'s raw HID interface wasn't found (USB says ${firmware.serial}; raw HID showed ${saw})` };
  }

  let writeError: string | undefined;
  log(`keyloom: sending the bootloader command to the ${target.name} (running ${firmware.serial})`);
  try {
    await transport.write(iface, bootloaderPacket());
  } catch (err) {
    writeError = (err as Error).message;
    log(`keyloom: the write reported an error, checking whether the keyboard restarted anyway: ${writeError}`);
  }

  const pollMs = deps.pollMs ?? 500;
  // After a failed write the reset, if it happened, shows within a moment; waiting the full time would only delay the real error.
  const deadline = Date.now() + (writeError === undefined ? waitMs : Math.min(waitMs, WRITE_ERROR_WAIT_MS));
  for (;;) {
    let devices: UsbDevice[] | undefined;
    try {
      devices = await deps.usb();
    } catch {
      // A failed listing is retried until the deadline, like a keyboard that has not appeared yet.
    }
    if (devices !== undefined) {
      if (inBootloader(devices, target)) {
        log(`keyloom: the keyboard is in its bootloader (${target.bootloader})`);
        return { ok: true };
      }
      // Zapp starts writing the moment the bootloader appears and can finish before the next poll, so the running
      // keyboard having gone is proof enough that it restarted.
      if (!devices.some((d) => isKeyboard(d, target))) {
        log("keyloom: the keyboard has left USB, so it restarted");
        return { ok: true };
      }
    }
    if (Date.now() >= deadline) break;
    await sleep(pollMs);
  }
  return { ok: false, reason: writeError ?? `the command was sent, but the ${target.name} didn't enter its bootloader within ${Math.round(waitMs / 1000)} seconds` };
}

export type VerifyResult = { ok: true; message: string } | { ok: false; error: string };

export const VERIFY_WAIT_MS = 45_000;

/** After a flash: the keyboard must come back running `buildId`'s firmware. */
export async function verifyBuild(deps: HandsFreeDeps, target: KeyboardTarget, buildId: string, log: (line: string) => void, waitMs = VERIFY_WAIT_MS): Promise<VerifyResult> {
  const expected = buildMarker(buildId);
  const pollMs = deps.pollMs ?? 1000;
  const deadline = Date.now() + waitMs;
  let seen: RunningFirmware = { state: "absent" };
  for (;;) {
    try {
      seen = await readRunningFirmware(deps, target);
    } catch {
      // Retried until the deadline.
    }
    if (seen.state === "keyloom" && seen.serial === expected) {
      return { ok: true, message: `Verified: the keyboard is running build ${buildId}.` };
    }
    // A keyboard that is back with different firmware won't change by waiting longer.
    if (seen.state !== "absent") break;
    if (Date.now() >= deadline) break;
    await sleep(pollMs);
  }
  log(`keyloom: after the flash the keyboard reports ${seen.state === "absent" ? "nothing" : `serial ${seen.serial ?? "(none)"}`}; expected ${expected}`);
  if (seen.state === "absent") {
    return { ok: false, error: `zapp finished, but the ${target.name} didn't come back within ${Math.round(waitMs / 1000)} seconds, so keyloom couldn't confirm the flash. Unplug it, plug it in again and run \`keyloom doctor\` to see what it is running.` };
  }
  return { ok: false, error: `zapp finished, but the ${target.name} is running ${seen.serial ?? "firmware with no serial"} and not build ${buildId} (${expected}). The flash may not have been written; flash again.` };
}

export const realHandsFreeDeps = (over: Partial<HandsFreeDeps> = {}): HandsFreeDeps => ({ usb: listUsbDevices, hid: defaultHidTransport, ...over });

/** The keyboard a board revision is on USB, or undefined when the board declares no product ID. ZSA's vendor ID is the default for a ZSA board that names none. */
export function keyboardIdentity(board: BoardDefinition, rev: QmkBoardRevision): KeyboardIdentity | undefined {
  const vendorId = rev.usbVendorId ?? (board.vendor === "ZSA" ? hexId(ZSA_VENDOR_ID) : null);
  if (rev.usbProductId === null || vendorId === null) return undefined;
  return { vendorId, productId: rev.usbProductId, name: board.name };
}

/** The keyboard keyloom can also restart into its bootloader: a ZSA board flashed by Zapp, whose firmware keyloom builds with the raw-HID command (D-070). */
export function keyboardTarget(board: BoardDefinition, rev: QmkBoardRevision): KeyboardTarget | undefined {
  const identity = keyboardIdentity(board, rev);
  if (board.vendor !== "ZSA" || rev.flash.kind !== "zapp" || identity === undefined) return undefined;
  return { ...identity, bootloader: rev.flash.bootloader };
}

/**
 * What a flash adds when the keyboard can be flashed hands-free: the bootloader command, if the keyboard
 * runs keyloom's firmware now, and verification, if the file being written is a keyloom build.
 */
export async function handsFreeHooks(input: {
  deps: HandsFreeDeps;
  board: BoardDefinition;
  rev: QmkBoardRevision;
  artifact: Uint8Array;
  buildId: string;
  log: LogSink;
}): Promise<Pick<FlashInput, "enterBootloader" | "verify">> {
  const target = keyboardTarget(input.board, input.rev);
  if (!target) return {};
  const say = (line: string) => input.log.line(line);
  const hooks: Pick<FlashInput, "enterBootloader" | "verify"> = {};

  let running: RunningFirmware | undefined;
  try {
    running = await readRunningFirmware(input.deps, target);
  } catch (err) {
    say(`keyloom: couldn't read the USB devices, so hands-free flashing is off: ${(err as Error).message}`);
  }
  if (running?.state === "keyloom") {
    say(`keyloom: the ${target.name} is running ${running.serial}, so it can be restarted into its bootloader without a keypress`);
    hooks.enterBootloader = () => rebootToBootloader(input.deps, target, say);
  } else if (running?.state === "other") {
    say(`keyloom: the ${target.name} is running firmware keyloom didn't build (USB serial ${running.serial ?? "unavailable"}); it needs its bootloader key this once`);
  } else if (running?.state === "absent") {
    say(`keyloom: no ${target.name} is attached over USB right now`);
  }

  let marker: string | undefined;
  try {
    marker = buildMarker(input.buildId);
  } catch {
    // Not a build ID keyloom made, so no firmware can carry its marker.
  }
  if (marker !== undefined && markerInFirmware(input.artifact) === marker) hooks.verify = () => verifyBuild(input.deps, target, input.buildId, say);
  else say("keyloom: this build was made before hands-free flashing, so the flash can't be verified from the keyboard's serial number");
  return hooks;
}
