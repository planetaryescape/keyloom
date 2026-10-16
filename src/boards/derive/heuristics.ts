// Hands, thumbs, fingers, rows and mirror pairs worked out from a keyboard's key positions alone (22#building-the-board-definition),
// for a board nobody has described yet. They are the rules docs/research/new-keyboard.md tested on the Moonlander, Glove80 and
// Corne; test/boards/derive/heuristics.test.ts reproduces those numbers. The home row is the one fact geometry cannot give, so it
// is a parameter. Pure.
import { keyCentre } from "../key-slots.ts";
import type { GeometryKey } from "../schema.ts";

type Point = { x: number; y: number };
export type Hands = { left: number[]; right: number[] };

/** Positions grouped into runs where neighbours in sorted order are no more than `tolerance` apart. */
function cluster(values: readonly number[], tolerance: number): number[][] {
  const order = values.map((_, i) => i).sort((a, b) => (values[a] as number) - (values[b] as number));
  const groups: number[][] = [];
  for (const i of order) {
    const last = groups.at(-1);
    if (last && (values[i] as number) - (values[last.at(-1) as number] as number) <= tolerance) last.push(i);
    else groups.push([i]);
  }
  return groups;
}

const centres = (keys: readonly GeometryKey[]): Point[] => keys.map(keyCentre);

/** The board splits where its keys are furthest apart sideways; QMK's own chordal-hold guess falls back to the same rule (keyboard_c.py in qmk_firmware). */
export function deriveHands(keys: readonly GeometryKey[]): Hands {
  const xs = centres(keys).map((c) => c.x).sort((a, b) => a - b);
  let gap = 0;
  let mid = Number.POSITIVE_INFINITY;
  for (let i = 1; i < xs.length; i++) {
    const d = (xs[i] as number) - (xs[i - 1] as number);
    if (d > gap) {
      gap = d;
      mid = ((xs[i] as number) + (xs[i - 1] as number)) / 2;
    }
  }
  const out: Hands = { left: [], right: [] };
  centres(keys).forEach((c, p) => (c.x < mid ? out.left : out.right).push(p));
  return out;
}

// Keys in one column differ in x by a rotation's worth; this is how far apart two centres can be and still be one column.
const COLUMN_TOLERANCE = 0.3;
// A thumb key hangs this far below the key above it in its column.
const THUMB_DROP = 1.2;

type HandColumns = { columns: number[][]; thumbs: number[] };

/**
 * One hand's columns, outermost first, and its thumbs. A column of fewer than three keys is a thumb cluster's (columns of the main
 * block have at least three), and so is a key more than 1.2 units below the one above it.
 */
function handColumns(hand: "left" | "right", positions: readonly number[], c: readonly Point[]): HandColumns {
  const groups = cluster(positions.map((p) => (c[p] as Point).x), COLUMN_TOLERANCE).map((g) => g.map((i) => positions[i] as number));
  const thumbs: number[] = [];
  const columns: number[][] = [];
  for (const group of groups) {
    const column = [...group].sort((a, b) => (c[a] as Point).y - (c[b] as Point).y || a - b);
    if (column.length < 3) {
      thumbs.push(...column);
      continue;
    }
    const kept = [column[0] as number];
    for (const p of column.slice(1)) {
      if ((c[p] as Point).y - (c[kept.at(-1) as number] as Point).y > THUMB_DROP && kept.length >= 2) thumbs.push(p);
      else kept.push(p);
    }
    columns.push(kept);
  }
  const meanX = (col: number[]) => col.reduce((s, p) => s + (c[p] as Point).x, 0) / col.length;
  columns.sort((a, b) => meanX(a) - meanX(b));
  if (hand === "right") columns.reverse();
  return { columns, thumbs: thumbs.sort((a, b) => a - b) };
}

export type Fingers = { fingers: Record<string, string>; thumbs: number[]; columns: { left: number[][]; right: number[][] } };

/**
 * Fingers by column. The middle finger is the column whose top key sits highest, the stagger's apex; the ring finger is the column
 * outward of it, the pinky everything further out, and the index everything inward. Where several columns tie for highest the
 * middle one of them wins, so a flat-topped board still gets one middle finger.
 */
export function deriveFingers(keys: readonly GeometryKey[], hands: Hands): Fingers {
  const c = centres(keys);
  const fingers: Record<string, string> = {};
  const thumbs: number[] = [];
  const columns: Fingers["columns"] = { left: [], right: [] };
  for (const hand of ["left", "right"] as const) {
    const part = handColumns(hand, hands[hand], c);
    thumbs.push(...part.thumbs);
    columns[hand] = part.columns;
    for (const p of part.thumbs) fingers[String(p)] = `${hand}-thumb`;
    const tops = part.columns.map((col) => Math.round(Math.min(...col.map((p) => (c[p] as Point).y)) * 100) / 100);
    const highest = Math.min(...tops);
    const tied = tops.flatMap((y, i) => (y === highest ? [i] : []));
    const apex = tied[Math.floor(tied.length / 2)] ?? 0;
    part.columns.forEach((col, i) => {
      const offset = i - apex; // negative is outward: columns are listed outermost first
      const name = offset === 0 ? "middle" : offset === -1 ? "ring" : offset < -1 ? "pinky" : "index";
      for (const p of col) fingers[String(p)] = `${hand}-${name}`;
    });
  }
  return { fingers, thumbs: thumbs.sort((a, b) => a - b), columns };
}

// Keys of one row in neighbouring columns differ in height by the stagger, which is under half a unit; keys of different rows differ by a whole unit or more.
const ROW_LINK = 0.5;
const EPS = 1e-6;

/**
 * The main block's rows, top to bottom, as positions; thumbs are in none of them. A key joins the row of the key it is level with in
 * the next column in, and the two halves join where their rows are level, so a staggered or curved block (the Glove80's wells) still
 * reads as rows, which clustering raw heights does not.
 */
export function deriveRowGroups(keys: readonly GeometryKey[], found: Fingers): number[][] {
  const c = centres(keys);
  const y = (p: number) => (c[p] as Point).y;
  const parent = new Map<number, number>();
  const find = (p: number): number => {
    let root = p;
    while (parent.get(root) !== root) root = parent.get(root) as number;
    parent.set(p, root);
    return root;
  };
  const join = (p: number, q: number) => parent.set(find(p), find(q));
  for (const col of [...found.columns.left, ...found.columns.right]) for (const p of col) parent.set(p, p);

  const nearest = (p: number, among: readonly number[]) => among.reduce<number | undefined>((best, q) => (best === undefined || Math.abs(y(q) - y(p)) < Math.abs(y(best) - y(p)) ? q : best), undefined);
  for (const hand of ["left", "right"] as const) {
    const cols = found.columns[hand];
    for (let i = 1; i < cols.length; i++) {
      const outer = cols[i - 1] as number[];
      const inner = cols[i] as number[];
      for (const [from, to] of [[outer, inner], [inner, outer]] as const) {
        for (const p of from) {
          const q = nearest(p, to);
          if (q !== undefined && Math.abs(y(q) - y(p)) < ROW_LINK - EPS) join(p, q);
        }
      }
      // A column dropped by exactly half a unit (the Glove80's pinky columns) sits level with the key above it: an outer key half a
      // unit from two inner keys takes the upper one. Going inward only, because the other direction would be a guess.
      for (const p of outer) {
        const closest = nearest(p, inner);
        if (closest === undefined || Math.abs(y(closest) - y(p)) < ROW_LINK - EPS) continue; // already joined to a key level with it
        const level = inner.filter((q) => Math.abs(Math.abs(y(q) - y(p)) - ROW_LINK) < EPS).sort((a, b) => y(a) - y(b))[0];
        if (level !== undefined) join(p, level);
      }
    }
  }

  const meanY = (g: readonly number[]) => g.reduce((s, p) => s + y(p), 0) / g.length;
  const components = (hand: "left" | "right") => {
    const out = new Map<number, number[]>();
    for (const p of found.columns[hand].flat()) out.set(find(p), [...(out.get(find(p)) ?? []), p]);
    return [...out.values()];
  };
  // The halves need not share a column (the Moonlander's inner columns differ in length), so a row of one half joins the row of the
  // other that is level with it, when each is the other's nearest.
  const left = components("left");
  const right = components("right");
  const levelWith = (g: number[], among: number[][]) => among.reduce<number[] | undefined>((best, o) => (best === undefined || Math.abs(meanY(o) - meanY(g)) < Math.abs(meanY(best) - meanY(g)) ? o : best), undefined);
  for (const l of left) {
    const r = levelWith(l, right);
    if (r !== undefined && levelWith(r, left) === l && Math.abs(meanY(r) - meanY(l)) < ROW_LINK) join(l[0] as number, r[0] as number);
  }
  const rows = new Map<number, number[]>();
  for (const p of parent.keys()) rows.set(find(p), [...(rows.get(find(p)) ?? []), p]);
  return [...rows.values()].map((g) => g.sort((x, z) => x - z)).sort((x, z) => meanY(x) - meanY(z));
}

/** The row to start from when BK has not said: the one just below the middle of the block, which is the home row of a three-row board (the Corne) and of the Moonlander and Glove80. */
export const guessHomeRow = (rows: number): number => Math.ceil((rows - 1) / 2) + 1;

// Names keyloom's own boards use for the rows above and below home (boards/*/board.json): function, number, top, home, bottom, lower.
const ABOVE = ["top", "number", "function"] as const;
const BELOW = ["bottom", "lower"] as const;

/** Row names from the home row outward. `home` is 1-based from the top. Rows beyond the usual six get "above-N" and "below-N". */
export function rowNames(rows: number, home: number): string[] {
  return Array.from({ length: rows }, (_, i) => {
    const offset = i + 1 - home;
    if (offset === 0) return "home";
    if (offset < 0) return ABOVE[-offset - 1] ?? `above-${-offset}`;
    return BELOW[offset - 1] ?? `below-${offset}`;
  });
}

/**
 * Left-to-right partners: keys with the same finger on the same row, matched from the outside in, and thumbs matched from the
 * middle out. An unmatched key (an asymmetric layout) has no partner, which `boards check` reports as a warning, not an error.
 */
export function deriveMirror(keys: readonly GeometryKey[], hands: Hands, fingers: Record<string, string>, rowOf: ReadonlyMap<number, string>): Record<string, number> {
  const c = centres(keys);
  const group = (hand: "left" | "right") => {
    const out = new Map<string, number[]>();
    for (const p of hands[hand]) {
      const finger = (fingers[String(p)] ?? "").replace(/^(left|right)-/, "");
      const key = `${finger}|${finger === "thumb" ? "" : (rowOf.get(p) ?? "")}`;
      out.set(key, [...(out.get(key) ?? []), p]);
    }
    // Outermost first on both hands, so the n-th key in from the edge on the left pairs with the n-th on the right; a thumb cluster is ordered the same way.
    for (const list of out.values()) list.sort((a, b) => (hand === "left" ? 1 : -1) * ((c[a] as Point).x - (c[b] as Point).x) || a - b);
    return out;
  };
  const left = group("left");
  const right = group("right");
  const mirror: Record<string, number> = {};
  for (const [key, lefts] of left) {
    const rights = right.get(key) ?? [];
    lefts.forEach((p, i) => {
      const partner = rights[i];
      if (partner !== undefined) mirror[String(p)] = partner;
    });
  }
  return mirror;
}
