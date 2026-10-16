// `keyloom keyboard detect` (22#recognising-the-keyboard): the keyboards on USB, each either one keyloom has a board for, or with
// the candidates the generated index offers. It only reads USB; nothing is written to a device.
import type { Candidate } from "../boards/derive/detect.ts";
import { candidateById, detectCandidates, searchIndex } from "../boards/derive/detect.ts";
import { keyboardIndex } from "../boards/derive/keyboard-index.ts";
import { boardByUsbId, boardForCandidate } from "../boards/derive/known.ts";
import type { Board } from "../boards/load.ts";
import { realHandsFreeDeps } from "../firmware/qmk/handsfree-flash.ts";
import type { UsbDevice } from "../firmware/toolchain/usb.ts";
import { listBoardDefinitions } from "./boards.ts";
import type { HandsFreeOverrides } from "./firmware-drivers.ts";

export type KeyboardDeps = {
  /** How USB is read; tests pass a fake bus. */
  usb?: () => Promise<UsbDevice[]>;
  /** The boards that count as already known; defaults to every board keyloom has loaded. */
  boards?: Board[];
};

export type CandidateView = Pick<Candidate, "id" | "firmware" | "name" | "vendor" | "confidence" | "reasons"> & {
  /** The ZMK shield's controller requirement, or the QMK bootloader, so the choice can be made from the list. */
  detail: string;
};

export type DetectedKeyboard = {
  device: { vendorId: string; productId: string; product: string; maker: string; bcdDevice: string | null; serial: string | null };
  /** `known`: keyloom has a board for it. `candidates`: it could be one of these. `unknown`: it looks like a ZMK keyboard keyloom can't name. */
  status: "known" | "candidates" | "unknown";
  knownBoard: { id: string; name: string } | null;
  candidates: CandidateView[];
  /** True when the evidence does not single one candidate out; keyloom will not choose for the person. */
  ambiguous: boolean;
  /** What to do next, as a command. */
  next: string;
};

const ZMK_DEFAULT = { vendorId: "0x1d50", productId: "0x615e" };

export const candidateView = (c: Candidate): CandidateView => ({
  id: c.id, firmware: c.firmware, name: c.name, vendor: c.vendor, confidence: c.confidence, reasons: c.reasons,
  detail: c.entry.kind === "qmk"
    ? `${c.entry.qmk.target}, ${c.entry.qmk.bootloader ?? "bootloader unknown"}${c.entry.qmk.split ? ", split" : ""}`
    : `${c.entry.zmk.kind}${c.entry.zmk.requires?.length ? `, needs a ${c.entry.zmk.requires.join("/")} controller` : ""}${c.entry.zmk.siblings.length > 1 ? `, ${c.entry.zmk.siblings.length} halves` : ""}`,
});

/** The keyboards on USB that are, or may be, a QMK or ZMK keyboard. A hub, a mouse or a phone is left out. */
export async function detectKeyboards(deps: KeyboardDeps = {}, over: HandsFreeOverrides = {}): Promise<DetectedKeyboard[]> {
  const devices = await (deps.usb ?? realHandsFreeDeps(over).usb)();
  const boards = (deps.boards ?? listBoardDefinitions()).map((b) => b.definition);
  const index = keyboardIndex();
  const out: DetectedKeyboard[] = [];
  for (const d of devices) {
    const identity = { vendorId: d.vendorId, productId: d.productId, product: d.name, maker: d.maker, ...(d.bcdDevice === undefined ? {} : { bcdDevice: d.bcdDevice }) };
    const { candidates, ambiguous } = detectCandidates(index, identity);
    const own = boardByUsbId(boards, identity) ?? (candidates[0] && !ambiguous ? boardForCandidate(boards, candidates[0]) : undefined);
    const zmkLooking = d.vendorId === ZMK_DEFAULT.vendorId && d.productId === ZMK_DEFAULT.productId;
    if (candidates.length === 0 && own === undefined && !zmkLooking) continue;
    const device = { vendorId: d.vendorId, productId: d.productId, product: d.name, maker: d.maker, bcdDevice: d.bcdDevice ?? null, serial: d.serial ?? null };
    if (own !== undefined) {
      out.push({ device, status: "known", knownBoard: { id: own.id, name: own.name }, candidates: candidates.map(candidateView), ambiguous: false, next: `keyloom boards show ${own.id}` });
    } else if (candidates.length === 0) {
      out.push({ device, status: "unknown", knownBoard: null, candidates: [], ambiguous: false, next: `keyloom keyboard detect --search "<part of its name>"` });
    } else {
      const top = candidates[0] as Candidate;
      out.push({
        device, status: "candidates", knownBoard: null, candidates: candidates.map(candidateView), ambiguous,
        next: `keyloom keyboard add --candidate ${top.id} --home-row <n>${ambiguous ? "   (choose the right candidate first)" : ""}`,
      });
    }
  }
  return out;
}

/** Index entries by name, for a keyboard USB could not name. */
export const searchKeyboards = (text: string): CandidateView[] => searchIndex(keyboardIndex(), text).map(candidateView);

export const findCandidate = (id: string): Candidate | undefined => candidateById(keyboardIndex(), id);
