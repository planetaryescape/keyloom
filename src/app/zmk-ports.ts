// Which USB serial ports belong to which ZMK board, for telling two boards' halves apart (D-095).
import type { SerialPort } from "../firmware/toolchain/serial.ts";
import { zmkRevision } from "../firmware/zmk/board-config.ts";
import { listBoardDefinitions } from "./boards.ts";

/**
 * Whether a serial port is a half of a different ZMK board keyloom knows by USB ID. Without this, a board whose IDs are unknown
 * (the Corne) would take another board's half as its own, because both carry keyloom's marker.
 */
export function portOfAnotherBoard(boardId: string): (port: SerialPort) => boolean {
  const claimed = new Set<string>();
  for (const board of listBoardDefinitions()) {
    if (board.definition.firmware !== "zmk" || board.definition.id === boardId) continue;
    for (const r of board.definition.revisions) {
      const handsFree = zmkRevision(board.definition, r.id).flash.handsFree;
      for (const h of handsFree?.halves ?? []) {
        if (handsFree?.usbVendorId && h.usbProductId) claimed.add(`${handsFree.usbVendorId.toLowerCase()}:${h.usbProductId.toLowerCase()}`);
      }
    }
  }
  const hex = (n: number) => `0x${n.toString(16).padStart(4, "0")}`;
  return (port) => claimed.has(`${hex(port.vendorId)}:${hex(port.productId)}`);
}
