// What is attached and what it is running (`keyloom doctor`), and restarting it into its bootloader
// (`keyloom flash --reboot-only`). Both read USB and, for the restart, raw HID through HandsFreeDeps.
import { qmkRevision } from "../firmware/qmk/board-config.ts";
import { requirePlatformSupport } from "../firmware/toolchain/platform-support.ts";
import { zmkRevision } from "../firmware/zmk/board-config.ts";
import { portOfAnotherBoard } from "./zmk-ports.ts";
import { type HalfFirmware, type ZmkHandsFreeDeps, halfTargets, readHalf, restartHalf, realZmkHandsFreeDeps } from "../firmware/zmk/handsfree-flash.ts";
import { type HandsFreeDeps, type KeyboardIdentity, type KeyboardTarget, type RunningFirmware, keyboardIdentity, keyboardTarget, readRunningFirmware, realHandsFreeDeps, rebootToBootloader } from "../firmware/qmk/handsfree-flash.ts";
import type { HandsFreeOverrides } from "./firmware-drivers.ts";
import type { HidTransport } from "../firmware/toolchain/hid.ts";
import { listBoardDefinitions, showBoard } from "./boards.ts";
import { UsageError } from "./errors.ts";
import { RebootFailedError } from "./firmware-errors.ts";

export type { HandsFreeDeps };
export type { HandsFreeOverrides } from "./firmware-drivers.ts";

/** `target` is set only for a keyboard keyloom can restart into its bootloader; any other board with USB ids is seen, not restarted (D-237). */
export type AttachedKeyboard = { boardId: string; boardName: string; revisionId: string; identity: KeyboardIdentity; target: KeyboardTarget | undefined; firmware: RunningFirmware };

/** Every attached QMK keyboard keyloom has a board for, one per board revision it recognises by USB ids. */
export async function attachedKeyboards(deps: HandsFreeDeps = realHandsFreeDeps()): Promise<AttachedKeyboard[]> {
  const found: AttachedKeyboard[] = [];
  const devices = await deps.usb();
  const cached: HandsFreeDeps = { ...deps, usb: async () => devices };
  for (const board of listBoardDefinitions()) {
    if (board.definition.firmware !== "qmk") continue;
    for (const r of board.definition.revisions) {
      const rev = qmkRevision(board.definition, r.id);
      const identity = keyboardIdentity(board.definition, rev);
      if (!identity) continue;
      const firmware = await readRunningFirmware(cached, identity);
      if (firmware.state !== "absent") found.push({ boardId: board.definition.id, boardName: board.definition.name, revisionId: r.id, identity, target: keyboardTarget(board.definition, rev), firmware });
    }
  }
  return found;
}

export type AttachedZmkHalf = { boardId: string; boardName: string; label: string; firmware: HalfFirmware; permissionDenied?: true };

/**
 * Every half of a ZMK board with a hands-free recipe that is attached and shows itself: by keyloom's marker in its serial
 * number, or (where the board's USB IDs are known) as a USB device without one. A half that is absent is left out.
 */
export async function attachedZmkHalves(deps: ZmkHandsFreeDeps): Promise<AttachedZmkHalf[]> {
  const ports = await (await deps.serial()).list();
  const found: AttachedZmkHalf[] = [];
  for (const board of listBoardDefinitions()) {
    if (board.definition.firmware !== "zmk") continue;
    for (const r of board.definition.revisions) {
      const rev = zmkRevision(board.definition, r.id);
      if (!rev.flash.handsFree) continue;
      for (const target of halfTargets(board.definition, rev.flash.handsFree, rev.flash.steps, portOfAnotherBoard(board.definition.id))) {
        const firmware = await readHalf(deps, target, ports);
        if (firmware.state !== "absent") found.push({ boardId: board.definition.id, boardName: board.definition.name, label: target.step.label, firmware,
          ...(firmware.state === "keyloom" && ports.find((p) => p.path === firmware.path)?.permissionDenied ? { permissionDenied: true as const } : {}),
        });
      }
    }
  }
  return found;
}

/** What `doctor` says about the raw HID side: whether keyloom could send the bootloader command right now. */
export async function rawHidFinding(deps: HandsFreeDeps, keyboard: AttachedKeyboard): Promise<string> {
  let transport: HidTransport;
  try {
    transport = await deps.hid();
  } catch (err) {
    return `no raw HID access: ${(err as Error).message}`;
  }
  try {
    const hex = (n: number) => `0x${n.toString(16).padStart(4, "0")}`;
    const found = (await transport.list()).find((h) => hex(h.vendorId) === keyboard.identity.vendorId && hex(h.productId) === keyboard.identity.productId);
    if (found?.permissionDenied) return `hidraw read/write permission denied; add a udev rule scoped to VID ${hex(found.vendorId)} and PID ${hex(found.productId)} granting your user access, reload rules and reconnect`;
    return found ? "its raw HID interface is visible" : "its raw HID interface was not found";
  } catch (err) {
    return `couldn't list HID devices: ${(err as Error).message}`;
  }
}

export type RebootOutcome = { board: string; revision: string; previousFirmware: string; bootloader: string; transportOnly?: true };

/**
 * Restarts the attached keyboard into its bootloader and stops there; nothing is flashed, and the keyboard
 * stays in the bootloader until it is flashed or unplugged. Only a keyboard running keyloom's firmware can be restarted.
 */
export async function rebootKeyboard(opts: { board?: string; half?: string; handsFree?: HandsFreeOverrides; onLine?: (line: string) => void } = {}): Promise<RebootOutcome> {
  requirePlatformSupport("keyloom flash --reboot-only");
  if (opts.board) {
    const board = showBoard(opts.board);
    if (board.definition.firmware === "zmk") {
      const revision = zmkRevision(board.definition);
      if (!revision.flash.handsFree) throw new UsageError(`${board.definition.name} has no hands-free restart recipe`);
      const targets = halfTargets(board.definition, revision.flash.handsFree, revision.flash.steps, portOfAnotherBoard(board.definition.id));
      const target = targets.find((t) => t.half.marker.toLowerCase() === opts.half?.toLowerCase() || t.step.label === `${opts.half} half`);
      if (!target) throw new UsageError("with a ZMK board, choose --half left or --half right");
      const result = await restartHalf({ deps: realZmkHandsFreeDeps(opts.handsFree?.zmk), targets, target,
        findVolume: async () => null, waitForVolume: false, log: (line) => opts.onLine?.(line) });
      if (!result.ok) throw new RebootFailedError(`couldn't request restart of ${board.definition.name} ${target.step.label}: ${result.reason}`);
      return { board: board.definition.id, revision: revision.id, previousFirmware: "keyloom firmware", bootloader: target.step.volume, transportOnly: true };
    }
  }
  if (opts.half !== undefined) throw new UsageError("--half needs --board naming a ZMK board");
  const deps = realHandsFreeDeps(opts.handsFree);
  const seen = (await attachedKeyboards(deps)).filter((k) => opts.board === undefined || k.boardId === opts.board);
  const attached = seen.filter((k) => k.target !== undefined);
  if (attached.length === 0 && seen.length > 0) throw new UsageError(`the ${seen[0]?.boardName} is attached, but keyloom can only restart a ZSA keyboard running its own firmware into the bootloader; put it there with its own reset key`);
  if (attached.length === 0) throw new UsageError(opts.board ? `no ${opts.board} keyboard is attached` : "no keyboard keyloom can restart is attached");
  if (attached.length > 1) throw new UsageError(`more than one keyboard is attached (${attached.map((k) => `${k.boardId} ${k.revisionId}`).join(", ")}); say which with --board`);
  const keyboard = attached[0] as AttachedKeyboard;
  const target = keyboard.target as KeyboardTarget;
  const result = await rebootToBootloader(deps, target, (line) => opts.onLine?.(line));
  if (!result.ok) throw new RebootFailedError(`couldn't restart the ${keyboard.boardName} into its bootloader: ${result.reason}`);
  return {
    board: keyboard.boardId, revision: keyboard.revisionId,
    previousFirmware: keyboard.firmware.state === "keyloom" ? keyboard.firmware.serial : "unknown", bootloader: target.bootloader,
  };
}
