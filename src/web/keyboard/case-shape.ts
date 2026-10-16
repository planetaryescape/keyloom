// The board's case, drawn under its keys so each keyboard looks like itself instead of keys on a tray (D-266). Everything comes from
// the board's geometry and display hints; a contributed board gets a case with no code of its own.
import type { BoardDefinition, GeometryKey } from "../../boards/schema.ts";
import { boardBounds, MAX_SPLIT_OVERLAP, rotatedCorners, type Point } from "./geometry.ts";

export type CasePart =
  /** A body or a module: a filled outline. */
  | { kind: "body"; d: string }
  /** A sculpted key well, darker than the body (the Glove80's columns). */
  | { kind: "well"; d: string }
  /** A laptop's aluminium deck, and the recess its keys sit in. */
  | { kind: "deck"; d: string }
  | { kind: "recess"; d: string };

// How far the case reaches past its keys, in key units.
const BODY_PAD = 0.28;
const MODULE_PAD = 0.22;
const HULL_PAD = 0.3;
const DECK_PAD = 0.55;

type Hands = { left: readonly number[]; right: readonly number[] };
type Display = BoardDefinition["display"];

export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  // Andrew's monotone chain: each half keeps only left turns.
  const half = (ordered: readonly Point[]): Point[] => {
    const chain: Point[] = [];
    for (const p of ordered) {
      for (let a = chain.at(-2), b = chain.at(-1); a !== undefined && b !== undefined && cross(a, b, p) <= 0; a = chain.at(-2), b = chain.at(-1)) chain.pop();
      chain.push(p);
    }
    return chain.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

const f = (n: number) => Number(n.toFixed(3));

/** A closed path through `points` with every corner rounded to at most `radius` (half the shorter edge, so short edges stay clean). */
export function roundedPath(points: readonly Point[], radius: number): string {
  const n = points.length;
  if (n < 3) return "";
  const parts = points.map((p, i) => {
    const a = points.at(i - 1) ?? p;
    const b = points.at((i + 1) % n) ?? p;
    const da = Math.hypot(p.x - a.x, p.y - a.y);
    const db = Math.hypot(b.x - p.x, b.y - p.y);
    const ra = Math.min(radius, da / 2);
    const rb = Math.min(radius, db / 2);
    const start = { x: p.x + ((a.x - p.x) * ra) / da, y: p.y + ((a.y - p.y) * ra) / da };
    const end = { x: p.x + ((b.x - p.x) * rb) / db, y: p.y + ((b.y - p.y) * rb) / db };
    return `${i === 0 ? "M" : "L"}${f(start.x)},${f(start.y)} Q${f(p.x)},${f(p.y)} ${f(end.x)},${f(end.y)}`;
  });
  return `${parts.join(" ")} Z`;
}

function rect(x: number, y: number, w: number, h: number): Point[] {
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

// Corners of a key grown by `pad` on every side, in its own rotation.
function grown(key: GeometryKey, pad: number): Point[] {
  return rotatedCorners({ ...key, x: key.x - pad, y: key.y - pad, w: key.w + 2 * pad, h: key.h + 2 * pad });
}

// A box around keys that are all square to the page; a hull around keys where any one turns.
function outline(keys: readonly GeometryKey[], pad: number, radius: number): string {
  if (keys.every((key) => key.r === 0)) {
    const b = boardBounds(keys);
    return roundedPath(rect(b.minX - pad, b.minY - pad, b.width + 2 * pad, b.height + 2 * pad), radius);
  }
  return roundedPath(convexHull(keys.flatMap((key) => grown(key, pad))), radius * 1.5);
}

/**
 * The parts of a board's case, in key units on the same canvas as its keys. `only` limits it to one hand, as a phone shows.
 *
 * - A display rotation group (the Moonlander's thumb clusters) is its own module, drawn square in its own frame and then turned.
 * - Each hand's other keys make one body. Two hands whose keys interleave (a laptop) make one body together.
 * - `display.surface` "wells" sinks each straight column into a well; "deck" draws an aluminium deck with the keys in a recess.
 */
export function caseParts(keys: readonly GeometryKey[], hands: Hands, display: Display, only: "left" | "right" | null = null): CasePart[] {
  const at = (positions: readonly number[]) => positions.flatMap((p) => keys[p] ?? []);
  const shown = only === null ? null : new Set(hands[only]);
  const visible = (p: number) => shown === null || shown.has(p);

  if (display?.surface === "deck") {
    const all = keys.filter((_, p) => visible(p));
    if (all.length === 0) return [];
    const b = boardBounds(all);
    return [
      { kind: "deck", d: roundedPath(rect(b.minX - DECK_PAD, b.minY - DECK_PAD, b.width + 2 * DECK_PAD, b.height + 2 * DECK_PAD), 0.55) },
      { kind: "recess", d: roundedPath(rect(b.minX - 0.12, b.minY - 0.12, b.width + 0.24, b.height + 0.24), 0.22) },
    ];
  }

  const parts: CasePart[] = [];
  const inModule = new Set<number>();
  for (const group of display?.rotate ?? []) {
    const members = group.positions.filter(visible);
    for (const p of group.positions) inModule.add(p);
    const turned = at(members);
    const pivot = turned[0];
    if (pivot === undefined) continue;
    // The pivot comes from the keys, not the rotation group: display.shift has moved the keys (and their pivot) after rotation, so the
    // group's own rx is where the module was before the halves were spread.
    const b = boardBounds(turned.map((key) => ({ ...key, r: 0, rx: 0, ry: 0 })));
    const corners = rotatedCorners({ x: b.minX - MODULE_PAD, y: b.minY - MODULE_PAD, w: b.width + 2 * MODULE_PAD, h: b.height + 2 * MODULE_PAD, r: pivot.r, rx: pivot.rx, ry: pivot.ry });
    parts.push({ kind: "body", d: roundedPath(corners, 0.3) });
  }

  const body = (positions: readonly number[]) => at(positions.filter((p) => visible(p) && !inModule.has(p)));
  const left = body(hands.left);
  const right = body(hands.right);
  const interleaved =
    left.length > 0 && right.length > 0 && (() => {
      const l = boardBounds(left);
      return l.minX + l.width - boardBounds(right).minX > MAX_SPLIT_OVERLAP;
    })();
  const bodies = interleaved ? [[...left, ...right]] : [left, right].filter((group) => group.length > 0);
  // Bodies go first so the modules, drawn after, sit on top of them where they meet.
  const drawn: CasePart[] = bodies.map((group) => ({ kind: "body", d: outline(group, group.every((k) => k.r === 0) ? BODY_PAD : HULL_PAD, 0.36) }));
  if (display?.surface === "wells") {
    for (const group of bodies) {
      const columns = new Map<number, GeometryKey[]>();
      for (const key of group) if (key.r === 0) columns.set(key.x, [...(columns.get(key.x) ?? []), key]);
      for (const column of columns.values()) {
        const b = boardBounds(column);
        drawn.push({ kind: "well", d: roundedPath(rect(b.minX + 0.03, b.minY + 0.02, b.width - 0.06, b.height - 0.04), 0.3) });
      }
      for (const key of group) if (key.r !== 0) drawn.push({ kind: "well", d: roundedPath(grown(key, -0.02), 0.25) });
    }
  }
  return [...drawn, ...parts];
}
