// What is attached and what it is running (`keyloom doctor`), and restarting it into its bootloader
// (`keyloom flash --reboot-only`). Both read USB and, for the restart, raw HID through HandsFreeDeps.
import { qmkRevision } from "../firmware/qmk/board-config.ts";
import { type HandsFreeDeps, type KeyboardTarget, type RunningFirmware, keyboardTarget, readRunningFirmware, realHandsFreeDeps, rebootToBootloader } from "../firmware/qmk/handsfree-flash.ts";
import { ZSA_VENDOR_ID } from "../firmware/qmk/handsfree.ts";
import type { HidTransport } from "../firmware/toolchain/hid.ts";
import { listBoardDefinitions } from "./boards.ts";
import { UsageError } from "./errors.ts";
import { RebootFailedError } from "./firmware-errors.ts";

export type { HandsFreeDeps };

export type AttachedKeyboard = { boardId: string; boardName: string; revisionId: string; target: KeyboardTarget; firmware: RunningFirmware };

/** Every attached keyboard keyloom can restart, one per board revision it recognises by USB product ID. */
export async function attachedKeyboards(deps: HandsFreeDeps = realHandsFreeDeps()): Promise<AttachedKeyboard[]> {
  const found: AttachedKeyboard[] = [];
  const devices = await deps.usb();
  const cached: HandsFreeDeps = { ...deps, usb: async () => devices };
  for (const board of listBoardDefinitions()) {
    if (board.definition.firmware !== "qmk") continue;
    for (const r of board.definition.revisions) {
      const rev = qmkRevision(board.definition, r.id);
      const target = keyboardTarget(board.definition, rev);
      if (!target) continue;
      const firmware = await readRunningFirmware(cached, target);
      if (firmware.state !== "absent") found.push({ boardId: board.definition.id, boardName: board.definition.name, revisionId: r.id, target, firmware });
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
    const found = (await transport.list()).some((h) => h.vendorId === ZSA_VENDOR_ID && `0x${h.productId.toString(16).padStart(4, "0")}` === keyboard.target.productId);
    return found ? "its raw HID interface is visible" : "its raw HID interface was not found";
  } catch (err) {
    return `couldn't list HID devices: ${(err as Error).message}`;
  }
}

export type RebootOutcome = { board: string; revision: string; previousFirmware: string; bootloader: string };

/**
 * Restarts the attached keyboard into its bootloader and stops there; nothing is flashed, and the keyboard
 * stays in the bootloader until it is flashed or unplugged. Only a keyboard running keyloom's firmware can be restarted.
 */
export async function rebootKeyboard(opts: { board?: string; handsFree?: Partial<HandsFreeDeps>; onLine?: (line: string) => void } = {}): Promise<RebootOutcome> {
  const deps = realHandsFreeDeps(opts.handsFree);
  const attached = (await attachedKeyboards(deps)).filter((k) => opts.board === undefined || k.boardId === opts.board);
  if (attached.length === 0) throw new UsageError(opts.board ? `no ${opts.board} keyboard is attached` : "no keyboard keyloom can restart is attached");
  if (attached.length > 1) throw new UsageError(`more than one keyboard is attached (${attached.map((k) => `${k.boardId} ${k.revisionId}`).join(", ")}); say which with --board`);
  const keyboard = attached[0] as AttachedKeyboard;
  const result = await rebootToBootloader(deps, keyboard.target, (line) => opts.onLine?.(line));
  if (!result.ok) throw new RebootFailedError(`couldn't restart the ${keyboard.boardName} into its bootloader: ${result.reason}`);
  return {
    board: keyboard.boardId, revision: keyboard.revisionId,
    previousFirmware: keyboard.firmware.state === "keyloom" ? keyboard.firmware.serial : "unknown", bootloader: keyboard.target.bootloader,
  };
}
