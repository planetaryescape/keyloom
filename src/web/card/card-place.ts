// Where the key card goes (23#map): beside the key, never over it or the keys around it. The board slides aside only when neither side
// has room (P2: "the halves part only when needed"). Pure, in screen pixels.

export interface Box { x: number; y: number; w: number; h: number }

export interface Placement {
  /** The card's top-left. */
  x: number;
  y: number;
  /** How far the board slides sideways to make room, in px; 0 when it doesn't have to. */
  shift: number;
}

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * `keep` is the key and its neighbours: the card may not cover any of them. `others` is every other key on the board: the card covers as
 * few of them as it can, and among equal spots it sits closest to the key. `gap` is the space kept around the keys, `margin` keeps the
 * card inside the stage. `prefer` is where the card already is, kept when it still fits.
 */
export function placeCard({ stage, key, keep, others = [], card, gap = 16, margin = 16, prefer }: { stage: Box; key: Box; keep: readonly Box[]; others?: readonly Box[]; card: { w: number; h: number }; gap?: number; margin?: number; prefer?: number }): Placement {
  const top = stage.y + margin;
  const bottom = stage.y + stage.h - margin;
  // A little above the key's middle, so a card that grows (the picker opening) grows past the key, not back over it.
  const y = Math.max(top, Math.min(key.y + key.h / 2 - Math.min(card.h, 260) / 2, bottom - card.h));
  const grown = (box: Box): Box => ({ x: box.x - gap, y: box.y - gap, w: box.w + 2 * gap, h: box.h + 2 * gap });
  const clear = keep.map(grown);
  const cx = key.x + key.w / 2;
  // A card that is already open keeps its place while it grows (a picker opening), as long as it still clears the key.
  if (prefer !== undefined && !clear.some((box) => overlaps({ x: prefer, y, w: card.w, h: card.h }, box))) return { x: prefer, y, shift: 0 };
  let best: { x: number; score: number } | null = null;
  for (let x = stage.x + margin; x + card.w <= stage.x + stage.w - margin; x += 8) {
    const area = { x, y, w: card.w, h: card.h };
    if (clear.some((box) => overlaps(area, box))) continue;
    const covered = others.filter((box) => overlaps(area, box)).length;
    const score = covered * 10_000 + Math.abs(x + card.w / 2 - cx);
    if (best === null || score < best.score) best = { x, score };
  }
  if (best !== null) return { x: best.x, y, shift: 0 };
  // No spot clears the key and its neighbours: the card takes the roomier edge of the stage and the board slides away from it.
  const left = Math.min(...keep.map((box) => box.x));
  const right = Math.max(...keep.map((box) => box.x + box.w));
  if (stage.x + stage.w - right >= left - stage.x) {
    const x = stage.x + stage.w - margin - card.w;
    return { x, y, shift: Math.min(0, x - gap - right) };
  }
  const x = stage.x + margin;
  return { x, y, shift: Math.max(0, x + card.w + gap - left) };
}
