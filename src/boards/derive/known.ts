// Whether a keyboard on USB is one keyloom already has a board definition for, so detection says "your Glove80" and stops there
// (research, "Detection flow" step 2) instead of offering to derive a second copy. Pure.
import type { BoardDefinition } from "../schema.ts";
import type { Candidate, UsbIdentity } from "./detect.ts";

const ZSA_VENDOR_ID = "0x3297";
const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The board whose revision declares these USB IDs for the running firmware (QMK `detect`, ZMK hands-free halves). */
export function boardByUsbId(boards: readonly BoardDefinition[], device: Pick<UsbIdentity, "vendorId" | "productId"> & Partial<Pick<UsbIdentity, "product">>): BoardDefinition | undefined {
  return boards.find((b) =>
    b.revisions.some((r) => {
      if (r.detect && (r.detect.product === undefined || r.detect.product === device.product) && r.detect.usbProductId.toLowerCase() === device.productId && (r.detect.usbVendorId ?? (b.vendor === "ZSA" ? ZSA_VENDOR_ID : undefined))?.toLowerCase() === device.vendorId) return true;
      const free = r.flash.kind === "uf2-drives" ? r.flash.handsFree : undefined;
      return free !== undefined && free.usbVendorId?.toLowerCase() === device.vendorId && free.halves.some((h) => h.usbProductId?.toLowerCase() === device.productId);
    }),
  );
}

/** The board that is the same keyboard as this candidate: same QMK folder, same ZMK shield, or the same name. */
export function boardForCandidate(boards: readonly BoardDefinition[], c: Candidate): BoardDefinition | undefined {
  return boards.find((b) => {
    if (c.entry.kind === "qmk") {
      const target = c.entry.qmk.target;
      // A folder that is the parent of a revision's (`zsa/moonlander` for `zsa/moonlander/reva`) is the same keyboard.
      if (b.revisions.some((r) => r.qmkTarget !== undefined && (r.qmkTarget === target || r.qmkTarget.startsWith(`${target}/`) || target.startsWith(`${r.qmkTarget}/`)))) return true;
    } else {
      const siblings = c.entry.zmk.siblings;
      if (b.revisions.some((r) => r.build.kind === "zmk-west-docker" && r.build.targets.some((t) => siblings.includes(t.shield ?? t.board ?? "")))) return true;
    }
    return b.firmware === c.firmware && normName(b.name) === normName(c.name);
  });
}
