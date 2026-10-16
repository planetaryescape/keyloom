// Where the key card sits (BK's decision, P2: "the halves part only when needed"). The card never covers the board. Pure, in stage px,
// with every box measured where it would be with the board unmoved.
//
// 1. If the card fits somewhere in the stage without covering any part of the board, it sits there, nearest the key.
// 2. Otherwise a split board parts: the half without the key slides away by as much as the card needs, the card sits in the gap, and
//    the whole board moves back by half the parting so it stays centred.
// 3. Only when the stage can't hold the parted halves does the whole board slide further, keeping the key's half and the card in view.

export interface Box { x: number; y: number; w: number; h: number }

export interface Seat {
  x: number;
  y: number;
  /** The half that slides, and by how far (negative is left). Null when the halves stay together. */
  part: { hand: "left" | "right"; px: number } | null;
  /** How far the whole board slides, in px. */
  shift: number;
  /** The board's scale about its centre: below 1 when the parted halves would otherwise run off the stage. */
  scale: number;
  /** False when sliding couldn't keep a one-piece board clear of the card (a laptop on a narrow stage). A split board's far half may
   *  run past the stage's edge, but the card never covers it. */
  clear: boolean;
}

const span = (boxes: readonly Box[]) => ({
  minX: Math.min(...boxes.map((b) => b.x)),
  maxX: Math.max(...boxes.map((b) => b.x + b.w)),
});
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));

// The parted board is never drawn below this share of its size; past it, it slides instead.
const MIN_SCALE = 0.8;

// The board keeps at least this much room at the stage's sides when it parts (P2 review).
const SIDE = 32;

export function seatCard({ area, key, keyHand, left, right, card, board: boardBox, gap = 20, margin = 16, avoid = [] }: {
  /** Where the card may go: the board's row, between the caption and the strip. */
  area: Box;
  key: Box;
  keyHand: "left" | "right" | null;
  /** Every part of each half (caps, case, LEDs). A one-piece board passes everything as `left` and an empty `right`. */
  left: readonly Box[];
  right: readonly Box[];
  card: { w: number; h: number };
  /** The board element's box, unmoved: what a scale is centred on. */
  board?: Box;
  /** Other things the card must not cover where it sits beside the board, such as the layer's title. */
  avoid?: readonly Box[];
  gap?: number;
  margin?: number;
}): Seat {
  const h = Math.min(card.h, area.h - 2 * margin);
  const y = clamp(key.y + key.h / 2 - Math.min(h, 260) / 2, area.y + margin, area.y + area.h - margin - h);
  const all = [...left, ...right, ...avoid].map((b) => ({ x: b.x - gap, y: b.y - gap, w: b.w + 2 * gap, h: b.h + 2 * gap }));
  const cx = key.x + key.w / 2;

  // 1. A free spot.
  let best: { x: number; d: number } | null = null;
  for (let x = area.x + margin; x + card.w <= area.x + area.w - margin; x += 8) {
    const box = { x, y, w: card.w, h };
    if (all.some((b) => overlaps(box, b))) continue;
    const d = Math.abs(x + card.w / 2 - cx);
    if (best === null || d < best.d) best = { x, d };
  }
  if (best !== null) return { x: best.x, y, part: null, shift: 0, scale: 1, clear: true };

  const board = span([...left, ...right]);
  const lo = area.x + SIDE;
  const hi = area.x + area.w - SIDE;

  // 2 and 3. Part a split board, scaled down if the parted halves wouldn't fit, and slid only if even that isn't enough.
  if (left.length > 0 && right.length > 0 && keyHand !== null) {
    const l = span(left);
    const r = span(right);
    const centre = boardBox === undefined ? { x: (board.minX + board.maxX) / 2, y: key.y } : { x: boardBox.x + boardBox.w / 2, y: boardBox.y + boardBox.h / 2 };
    const width = board.maxX - board.minX;
    const between = r.minX - l.maxX;
    const room = hi - lo;
    // The scale at which width·s + (card + 2·gap − between·s) fills the stage exactly.
    const fit = (room - card.w - 2 * gap) / Math.max(1, width - between);
    const scale = Math.min(1, Math.max(MIN_SCALE, fit));
    const at = (x: number) => centre.x + (x - centre.x) * scale;
    const need = Math.max(0, card.w + 2 * gap - between * scale);
    const keyY = centre.y + (key.y + key.h / 2 - centre.y) * scale;
    const yScaled = clamp(keyY - Math.min(h, 260) / 2, area.y + margin, area.y + area.h - margin - h);
    if (keyHand === "left") {
      const cardX = at(l.maxX) + gap;
      const shift = clamp(-need / 2, lo - at(l.minX), hi - (cardX + card.w));
      return { x: cardX + shift, y: yScaled, part: { hand: "right", px: need / scale }, shift, scale, clear: true };
    }
    const cardX = at(r.minX) - gap - card.w;
    const shift = clamp(need / 2, lo - cardX, hi - at(r.maxX));
    return { x: cardX + shift, y: yScaled, part: { hand: "left", px: -need / scale }, shift, scale, clear: true };
  }

  // A one-piece board slides away from the card, which takes the roomier edge.
  const rightRoom = hi - board.maxX;
  const leftRoom = board.minX - lo;
  if (rightRoom >= leftRoom) {
    const x = hi - card.w;
    const shift = Math.min(0, x - gap - board.maxX);
    return { x, y, part: null, shift, scale: 1, clear: board.minX + shift >= lo };
  }
  const x = lo;
  const shift = Math.max(0, x + card.w + gap - board.minX);
  return { x, y, part: null, shift, scale: 1, clear: board.maxX + shift <= hi };
}
