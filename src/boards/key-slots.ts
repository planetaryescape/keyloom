// Where a key sits on its board, in terms two different boards can share (20#position): which hand,
// which finger, how many rows above or below the home row, how many columns out from that finger's
// home key. Pure: it reads a board definition and its geometry and nothing else.
//
// Everything here is derived from geometry (x, y) and the facts in board.json, never from the order
// that board.json happens to list things in, so two spellings of one board give the same slots (the
// correspondence tests shuffle the records to prove it).
import type { BoardDefinition, Geometry, GeometryKey } from "./schema.ts";

export type Hand = "left" | "right";

export type KeySlot =
  | { position: number; hand: Hand; finger: string; thumb: false; rowOffset: number; colOffset: number }
  | { position: number; hand: Hand; finger: "thumb"; thumb: true; thumbRank: number };

/** Positions that sit on a board but belong to no hand or finger, so no other board can be matched to them by place. */
export type SlotTable = { slots: Map<number, KeySlot>; unplaced: number[] };

const FINGER_ORDER = ["index", "middle", "ring", "pinky"] as const;

/** The key's centre after its rotation, in key units, because a thumb cluster is rotated and its x and y alone say little. */
export function keyCentre(k: GeometryKey): { x: number; y: number } {
  const cx = k.x + k.w / 2;
  const cy = k.y + k.h / 2;
  if (k.r === 0) return { x: cx, y: cy };
  const a = (k.r * Math.PI) / 180;
  const dx = cx - k.rx;
  const dy = cy - k.ry;
  return { x: k.rx + dx * Math.cos(a) - dy * Math.sin(a), y: k.ry + dx * Math.sin(a) + dy * Math.cos(a) };
}

const handOf = (def: BoardDefinition, p: number): Hand | null => (def.hands.left.includes(p) ? "left" : def.hands.right.includes(p) ? "right" : null);

/** `left-index` -> `index`; a name that does not end in a finger is kept whole so it can only match itself. */
const fingerName = (raw: string | undefined): string | null => (raw === undefined ? null : raw.replace(/^(left|right)-/, ""));

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

// A float that is "the same column" on two keys of a hand-measured geometry can differ in the last digits.
const round = (n: number) => (Math.round(n) === 0 ? 0 : Math.round(n));

export function keySlots(def: BoardDefinition, geometry: Geometry): SlotTable {
  const centres = geometry.keys.map(keyCentre);
  const fingers = new Map<number, string>();
  const hands = new Map<number, Hand>();
  const unplaced: number[] = [];
  for (let p = 0; p < def.keyCount; p++) {
    const hand = handOf(def, p);
    const finger = fingerName(def.fingers[String(p)]);
    if (hand === null || finger === null || finger === "unknown") unplaced.push(p);
    else {
      hands.set(p, hand);
      fingers.set(p, finger);
    }
  }
  const placed = [...hands.keys()].sort((a, b) => a - b);
  const isThumb = (p: number) => fingers.get(p) === "thumb";

  // Rows are ordered by where they are, top to bottom, not by the order board.json lists them.
  const rowMeans = Object.entries(def.rows)
    .map(([name, positions]) => {
      const ys = positions.filter((p) => placed.includes(p) && !isThumb(p)).map((p) => (centres[p] as { y: number }).y);
      return { name, y: ys.length ? mean(ys) : Number.NaN };
    })
    .filter((r) => !Number.isNaN(r.y))
    .sort((a, b) => a.y - b.y || (a.name < b.name ? -1 : 1));
  const rowOf = new Map<number, string>();
  for (const [name, positions] of Object.entries(def.rows)) for (const p of positions) rowOf.set(p, name);
  const homeIndex = Math.max(0, rowMeans.findIndex((r) => r.name === "home") === -1 ? Math.floor(rowMeans.length / 2) : rowMeans.findIndex((r) => r.name === "home"));
  const rowRank = new Map(rowMeans.map((r, i) => [r.name, i - homeIndex]));

  // Outward is away from the middle of the board: left for the left hand, right for the right.
  const outward = (p: number) => {
    const x = (centres[p] as { x: number }).x;
    return hands.get(p) === "left" ? -x : x;
  };

  // A finger's home key is the one on the home row nearest the middle finger: the outermost of the index columns, the innermost of the rest.
  const anchors = new Map<string, number>();
  for (const hand of ["left", "right"] as const) {
    for (const finger of FINGER_ORDER) {
      const keys = placed.filter((p) => hands.get(p) === hand && fingers.get(p) === finger && !isThumb(p));
      if (keys.length === 0) continue;
      const onHome = keys.filter((p) => rowRank.get(rowOf.get(p) ?? "") === 0);
      const pool = onHome.length ? onHome : keys.filter((p) => Math.abs(rowRank.get(rowOf.get(p) ?? "") ?? 99) === Math.min(...keys.map((q) => Math.abs(rowRank.get(rowOf.get(q) ?? "") ?? 99))));
      const sorted = [...pool].sort((a, b) => outward(a) - outward(b) || a - b);
      anchors.set(`${hand}:${finger}`, (finger === "index" ? sorted[sorted.length - 1] : sorted[0]) as number);
    }
  }

  // The thumb cluster hangs below the main block, so rank it by how close each key is to the middle of the board at the bottom edge.
  const mainKeys = placed.filter((p) => !isThumb(p));
  const leftX = mainKeys.filter((p) => hands.get(p) === "left").map((p) => (centres[p] as { x: number }).x);
  const rightX = mainKeys.filter((p) => hands.get(p) === "right").map((p) => (centres[p] as { x: number }).x);
  const middleX = leftX.length && rightX.length ? (Math.max(...leftX) + Math.min(...rightX)) / 2 : 0;
  const bottomY = mainKeys.length ? Math.max(...mainKeys.map((p) => (centres[p] as { y: number }).y)) : 0;
  const thumbRank = new Map<number, number>();
  for (const hand of ["left", "right"] as const) {
    const thumbs = placed.filter((p) => hands.get(p) === hand && isThumb(p));
    const dist = (p: number) => {
      const c = centres[p] as { x: number; y: number };
      return Math.hypot(c.x - middleX, c.y - bottomY);
    };
    thumbs.sort((a, b) => dist(a) - dist(b) || a - b).forEach((p, i) => thumbRank.set(p, i));
  }

  const slots = new Map<number, KeySlot>();
  for (const p of placed) {
    const hand = hands.get(p) as Hand;
    const finger = fingers.get(p) as string;
    if (finger === "thumb") {
      slots.set(p, { position: p, hand, finger: "thumb", thumb: true, thumbRank: thumbRank.get(p) as number });
      continue;
    }
    const row = rowRank.get(rowOf.get(p) ?? "");
    const anchor = anchors.get(`${hand}:${finger}`);
    if (row === undefined || anchor === undefined) {
      unplaced.push(p);
      continue;
    }
    slots.set(p, { position: p, hand, finger, thumb: false, rowOffset: row, colOffset: round(outward(p) - outward(anchor)) });
  }
  return { slots, unplaced: unplaced.sort((a, b) => a - b) };
}

/** How far apart two slots are, for choosing between equally good function matches. Hand counts most, then finger, then row and column. */
export function slotDistance(a: KeySlot | undefined, b: KeySlot | undefined): number {
  if (a === undefined || b === undefined) return 1000;
  let d = a.hand === b.hand ? 0 : 100;
  if (a.thumb || b.thumb) return d + (a.thumb && b.thumb ? Math.abs(a.thumbRank - b.thumbRank) : 50);
  if (a.finger !== b.finger) d += 10 + Math.abs(FINGER_ORDER.indexOf(a.finger as never) - FINGER_ORDER.indexOf(b.finger as never));
  return d + 3 * Math.abs(a.rowOffset - b.rowOffset) + Math.abs(a.colOffset - b.colOffset);
}

/** A slot in words a person uses: "left ring finger, home row". */
export function describeSlot(s: KeySlot | undefined): string {
  if (s === undefined) return "no fixed place";
  if (s.thumb) return `${s.hand} thumb, key ${s.thumbRank + 1} from the middle`;
  const row = s.rowOffset === 0 ? "home row" : s.rowOffset < 0 ? `${-s.rowOffset} row${s.rowOffset === -1 ? "" : "s"} above home` : `${s.rowOffset} row${s.rowOffset === 1 ? "" : "s"} below home`;
  const col = s.colOffset === 0 ? "" : s.colOffset > 0 ? `, ${s.colOffset} column${s.colOffset === 1 ? "" : "s"} outward` : `, ${-s.colOffset} column${s.colOffset === -1 ? "" : "s"} inward`;
  return `${s.hand} ${s.finger}, ${row}${col}`;
}
