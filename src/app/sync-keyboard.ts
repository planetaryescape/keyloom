// What each board's keyboard is doing right now, as keyboard sync needs it (17): not there, in its bootloader, running
// someone else's firmware, or running keyloom builds (named by the keys in their USB serial numbers). It reads USB and
// serial ports only; nothing here writes to a device.
import type { Board } from "../boards/load.ts";
import { qmkRevision } from "../firmware/qmk/board-config.ts";
import { type HandsFreeDeps, inBootloader, keyboardTarget, readRunningFirmware, realHandsFreeDeps } from "../firmware/qmk/handsfree-flash.ts";
import { zmkRevision } from "../firmware/zmk/board-config.ts";
import { realZmkHandsFreeDeps } from "../firmware/zmk/handsfree-flash.ts";
import { listBoardDefinitions } from "./boards.ts";
import type { HandsFreeOverrides } from "./firmware-drivers.ts";
import { attachedZmkHalves } from "./keyboard.ts";

export type KeyboardReading =
  | { state: "absent" }
  /** The keyboard is in its bootloader and not typing: keyloom sent it there, or it was left there. */
  | { state: "bootloader" }
  /** Running firmware keyloom didn't build. */
  | { state: "other"; detail: string }
  /** Running keyloom builds; `keys` are the 12-character build keys its serial numbers carry, one per distinct build across its halves. */
  | { state: "keyloom"; keys: string[]; boardRevision: string };

/** Whether keyloom can tell what this board runs and restart it itself, which is what a sync needs. */
export function syncSupported(board: Board): boolean {
  const def = board.definition;
  if (def.firmware === "zmk") return def.revisions.some((r) => zmkRevision(def, r.id).flash.handsFree !== undefined);
  return def.revisions.some((r) => keyboardTarget(def, qmkRevision(def, r.id)) !== undefined);
}

export const syncableBoards = (): Board[] => listBoardDefinitions().filter(syncSupported);

/** `keyloom/AAAAAAAAAAAA` is build key `AAAAAAAAAAAA`. */
const keyOfMarker = (marker: string): string => marker.slice("keyloom/".length);

/** One reading per syncable board. A failed read is the board "absent", not an error: an unplugged keyboard and an unreadable bus look the same from here. */
export async function readKeyboards(over: HandsFreeOverrides = {}): Promise<Map<string, KeyboardReading>> {
  const out = new Map<string, KeyboardReading>();
  const deps = realHandsFreeDeps(over);
  let devices: Awaited<ReturnType<HandsFreeDeps["usb"]>> = [];
  try {
    devices = await deps.usb();
  } catch {
    // Every QMK board then reads as absent.
  }
  const cached: HandsFreeDeps = { ...deps, usb: async () => devices };

  for (const board of syncableBoards()) {
    const def = board.definition;
    if (def.firmware !== "qmk") continue;
    let reading: KeyboardReading = { state: "absent" };
    for (const r of def.revisions) {
      const rev = qmkRevision(def, r.id);
      const target = keyboardTarget(def, rev);
      if (!target) continue;
      const firmware = await readRunningFirmware(cached, target);
      if (firmware.state === "keyloom") {
        reading = { state: "keyloom", keys: [keyOfMarker(firmware.serial)], boardRevision: r.id };
        break;
      }
      if (firmware.state === "other") {
        reading = { state: "other", detail: `USB serial ${firmware.serial ?? "unavailable"}` };
        break;
      }
      if (inBootloader(devices, target)) reading = { state: "bootloader" };
    }
    out.set(def.id, reading);
  }

  try {
    const halves = await attachedZmkHalves(realZmkHandsFreeDeps({ usb: async () => devices, ...over.zmk }));
    for (const board of syncableBoards()) {
      const def = board.definition;
      if (def.firmware !== "zmk") continue;
      const mine = halves.filter((h) => h.boardId === def.id);
      const other = mine.find((h) => h.firmware.state === "other");
      if (mine.length === 0) out.set(def.id, { state: "absent" });
      else if (other && other.firmware.state === "other") {
        out.set(def.id, { state: "other", detail: `the ${other.label} reports USB serial ${other.firmware.serial ?? "unavailable"}` });
      } else {
        const keys = [...new Set(mine.flatMap((h) => (h.firmware.state === "keyloom" ? [h.firmware.key] : [])))];
        out.set(def.id, { state: "keyloom", keys, boardRevision: def.revisions[0]?.id ?? "" });
      }
    }
  } catch {
    for (const board of syncableBoards()) if (board.definition.firmware === "zmk" && !out.has(board.definition.id)) out.set(board.definition.id, { state: "absent" });
  }
  return out;
}
