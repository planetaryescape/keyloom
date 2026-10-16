// Naming a keyboard from what it says over USB (22#recognising-the-keyboard): vendor ID, product ID, product string and device
// version, matched against the generated index. The result is a ranked list with a reason for each, never a single silent guess: a
// shared or placeholder ID, or two close scores, is reported as ambiguous so the person chooses. Pure.
import type { KeyboardIndex, QmkEntry, ZmkEntry } from "./index-schema.ts";

export type UsbIdentity = { vendorId: string; productId: string; product: string; maker: string; bcdDevice?: string | undefined };

export type Candidate = {
  /** `qmk:crkbd/rev1` or `zmk:corne`: what `keyboard add --candidate` takes. */
  id: string;
  firmware: "qmk" | "zmk";
  name: string;
  vendor: string;
  confidence: number;
  reasons: string[];
  entry: { kind: "qmk"; qmk: QmkEntry } | { kind: "zmk"; zmk: ZmkEntry };
};

export type Detection = {
  candidates: Candidate[];
  /** True when the evidence does not single one out, so keyloom must ask. Always true for a placeholder ID. */
  ambiguous: boolean;
};

/** QMK's template ID, which a keyboard keeps when nobody changed it: 175 boards share `0xFEED:0x0000` (research, S42). */
const isPlaceholder = (vendorId: string): boolean => vendorId === "0xfeed";
/** ZMK's default ID, which most ZMK boards keep, so only the product string tells them apart. */
const ZMK_DEFAULT = { vendorId: "0x1d50", productId: "0x615e" };

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");
const round2 = (n: number): number => Math.round(n * 100) / 100;
const MAX_CANDIDATES = 10;
/** Two scores this close are not a choice keyloom should make for the person. */
const CLOSE = 0.15;
const FITS = 0.6;
const UNLIKELY = 0.2;

export const qmkCandidateId = (e: QmkEntry): string => `qmk:${e.target}`;
export const zmkCandidateId = (e: ZmkEntry): string => `zmk:${e.id}`;

function qmkCandidate(e: QmkEntry, device: UsbIdentity, pool: readonly QmkEntry[]): Candidate {
  const reasons = [`USB ID ${e.vid}:${e.pid} is ${pool.length === 1 ? "this keyboard's alone" : `shared by ${pool.length} keyboards in QMK`}`];
  let score = pool.length === 1 ? 0.6 : 0.25;
  const product = norm(device.product);
  if (product !== "") {
    const named = pool.filter((p) => norm(p.name) === product);
    if (norm(e.name) === product) {
      score += named.length === 1 ? 0.35 : 0.3;
      reasons.push(`its product string "${device.product}" is this keyboard's name${named.length === 1 && pool.length > 1 ? ", and no other keyboard with this ID has it" : ""}`);
    } else {
      score -= 0.2;
      reasons.push(`its product string "${device.product}" is not the name QMK gives it ("${e.name}")`);
    }
  }
  if (device.bcdDevice !== undefined && e.bcd !== undefined && device.bcdDevice === e.bcd && pool.some((p) => p.bcd !== e.bcd)) {
    score += 0.07;
    reasons.push(`its device version ${device.bcdDevice} matches`);
  }
  if (isPlaceholder(e.vid)) {
    score = Math.min(score, 0.55);
    reasons.push("0xFEED is QMK's placeholder vendor ID, so the ID alone cannot name a keyboard");
  }
  return {
    id: qmkCandidateId(e), firmware: "qmk", name: e.name, vendor: e.maker ?? e.target.split("/")[0] ?? "", confidence: round2(Math.min(0.99, Math.max(0.05, score))),
    reasons, entry: { kind: "qmk", qmk: e },
  };
}

function zmkCandidates(index: KeyboardIndex, device: UsbIdentity, qmkExplains: boolean): Candidate[] {
  const product = norm(device.product);
  if (product === "") return [];
  // A device whose ID and product string QMK knows, and not ZMK's default ID, is a QMK keyboard that shares a name with a ZMK one (the Corne is both).
  if (qmkExplains && !(device.vendorId === ZMK_DEFAULT.vendorId && device.productId === ZMK_DEFAULT.productId)) return [];
  const byName = index.zmk.filter((e) => Object.values(e.productNames ?? {}).some((n) => norm(n) === product));
  const byTitle = index.zmk.filter((e) => !byName.includes(e) && norm(e.name) === product);
  const isDefault = device.vendorId === ZMK_DEFAULT.vendorId && device.productId === ZMK_DEFAULT.productId;
  return [...byName, ...byTitle].map((e): Candidate => {
    const exact = byName.includes(e);
    const reasons = [
      exact
        ? `its product string "${device.product}" is the name ZMK's tree gives ${e.kind === "shield" ? "the shield" : "the board"} "${e.name}"${byName.length > 1 ? `, as it does ${byName.length - 1} other${byName.length > 2 ? "s" : ""}` : ""}`
        : `its product string "${device.product}" is the name of ${e.kind} "${e.name}", but ZMK's tree sets no product string for it`,
    ];
    let score = exact ? (byName.length === 1 ? 0.8 : 0.55) : 0.45;
    if (e.vid === device.vendorId && e.pid === device.productId) {
      score += 0.15;
      reasons.push(`its USB ID ${device.vendorId}:${device.productId} is the one the board sets`);
    } else if (isDefault) {
      reasons.push("it uses ZMK's default USB ID 0x1d50:0x615e, which most ZMK boards keep, so the product string is the only fingerprint");
    }
    return { id: zmkCandidateId(e), firmware: "zmk", name: e.name, vendor: "ZMK", confidence: round2(Math.min(0.99, score)), reasons, entry: { kind: "zmk", zmk: e } };
  });
}

/** Everything the index can say about one USB device, best first. */
export function detectCandidates(index: KeyboardIndex, device: UsbIdentity): Detection {
  const pool = index.qmk.filter((e) => e.vid === device.vendorId && e.pid === device.productId);
  const ranked = [...pool.map((e) => qmkCandidate(e, device, pool)), ...zmkCandidates(index, device, pool.some((e) => norm(e.name) === norm(device.product)))]
    .sort((a, b) => b.confidence - a.confidence || (a.id < b.id ? -1 : 1));
  // Once something fits well, the keyboards that merely share its ID (a V-USB ID is shared by 11 QMK boards) are noise, not a choice.
  const best = ranked[0]?.confidence ?? 0;
  const candidates = ranked.filter((c) => best < FITS || c.confidence >= UNLIKELY).slice(0, MAX_CANDIDATES);
  const [first, second] = candidates;
  const ambiguous = first !== undefined && (isPlaceholder(device.vendorId) || (second !== undefined && first.confidence - second.confidence < CLOSE));
  return { candidates, ambiguous };
}

/** The candidate an id names, whether or not any device suggested it: `keyboard add --candidate` also covers a keyboard that is not plugged in. */
export function candidateById(index: KeyboardIndex, id: string): Candidate | undefined {
  const [kind, ...rest] = id.split(":");
  const key = rest.join(":");
  if (kind === "qmk") {
    const e = index.qmk.find((x) => x.target === key);
    return e && { id, firmware: "qmk", name: e.name, vendor: e.maker ?? e.target.split("/")[0] ?? "", confidence: 1, reasons: ["named by you"], entry: { kind: "qmk", qmk: e } };
  }
  if (kind === "zmk") {
    const e = index.zmk.find((x) => x.id === key);
    return e && { id, firmware: "zmk", name: e.name, vendor: "ZMK", confidence: 1, reasons: ["named by you"], entry: { kind: "zmk", zmk: e } };
  }
  return undefined;
}

/** Index entries whose name contains `text`, for when the USB identity names nothing (a ZMK board that renamed itself). */
export function searchIndex(index: KeyboardIndex, text: string): Candidate[] {
  const q = norm(text);
  const hits = [
    ...index.qmk.filter((e) => norm(e.name).includes(q) || e.target.toLowerCase().includes(q)).map((e) => candidateById(index, `qmk:${e.target}`)),
    ...index.zmk.filter((e) => norm(e.name).includes(q) || e.id.toLowerCase().includes(q)).map((e) => candidateById(index, `zmk:${e.id}`)),
  ];
  return hits.flatMap((c) => (c === undefined ? [] : [{ ...c, confidence: 0, reasons: [`its name matches "${text}"`] }])).slice(0, 50);
}
