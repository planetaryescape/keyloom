// The board's case, drawn under its keys so each keyboard looks like itself instead of keys on a tray (D-266). Everything comes from
// the board's geometry and display hints; a contributed board gets a case with no code of its own.
import type { BoardDefinition, GeometryKey } from "../../boards/schema.ts";
import { boardBounds, MAX_SPLIT_OVERLAP, rotatedCorners, type Point } from "./geometry.ts";

/** Which hand a part belongs to, so a split board's halves can part (P2); null for one-piece boards. */
type Hand = "left" | "right" | null;

export type CasePart =
  /** A body or a module: a filled outline. */
  | { kind: "body"; d: string; hand: Hand }
  /** A sculpted key well, darker than the body (the Glove80's columns). */
  | { kind: "well"; d: string; hand: Hand }
  /** A laptop's aluminium deck, and the recess its keys sit in. */
  | { kind: "deck"; d: string; hand: Hand }
  | { kind: "recess"; d: string; hand: Hand }
  /** A case that hugs its keys (display.caseHug): many overlapping shapes filled as one, so it has no rim of its own. */
  | { kind: "plate"; d: string; hand: Hand }
  /** Drawn from the real object (display.case, D-277): a hinged module, a display's cover, metal tenting parts, knurling, a pinhole,
   *  a speaker grille, a fingerprint sensor, a trackball. */
  | { kind: "module" | "screen" | "leg" | "knob" | "knurl" | "hole" | "grille" | "sensor" | "ball"; d: string; hand: Hand };

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

  // A board drawn from photos wins over the computed case; its parts already know their hand. A one-piece case (a laptop's) can't be
  // cut down to one hand, so a phone showing one hand of it draws the computed case around that hand's keys instead.
  const oneHandOfOnePiece = only !== null && display?.case?.some((part) => part.hand === null) === true;
  // A drawn case keeps its column wells (the Glove80's, D-341): they come from the keys, and are drawn over the body they sink into.
  if (display?.case !== undefined && !oneHandOfOnePiece) {
    return [...display.case.filter((part) => only === null || part.hand === only).map((part) => ({ ...part })), ...wells(keys, hands, display, visible)];
  }

  if (display?.surface === "deck") {
    const all = keys.filter((_, p) => visible(p));
    if (all.length === 0) return [];
    const b = boardBounds(all);
    return [
      { kind: "deck", d: roundedPath(rect(b.minX - DECK_PAD, b.minY - DECK_PAD, b.width + 2 * DECK_PAD, b.height + 2 * DECK_PAD), 0.55), hand: null },
      { kind: "recess", d: roundedPath(rect(b.minX - 0.12, b.minY - 0.12, b.width + 0.24, b.height + 0.24), 0.22), hand: null },
    ];
  }

  if (display?.caseHug !== undefined) return [...huggedCase(keys, hands, display.caseHug, visible), ...wells(keys, hands, display, visible)];

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
    const hand: Hand = hands.left.includes(group.positions[0] ?? -1) ? "left" : hands.right.includes(group.positions[0] ?? -1) ? "right" : null;
    parts.push({ kind: "body", d: roundedPath(corners, 0.3), hand });
  }

  const body = (positions: readonly number[]) => at(positions.filter((p) => visible(p) && !inModule.has(p)));
  const left = body(hands.left);
  const right = body(hands.right);
  const interleaved =
    left.length > 0 && right.length > 0 && (() => {
      const l = boardBounds(left);
      return l.minX + l.width - boardBounds(right).minX > MAX_SPLIT_OVERLAP;
    })();
  const bodies: { keys: GeometryKey[]; hand: Hand }[] = interleaved
    ? [{ keys: [...left, ...right], hand: null }]
    : [{ keys: left, hand: "left" as const }, { keys: right, hand: "right" as const }].filter((group) => group.keys.length > 0);
  // Bodies go first so the modules, drawn after, sit on top of them where they meet.
  const drawn: CasePart[] = bodies.map(({ keys: group, hand }) => ({ kind: "body", d: outline(group, group.every((k) => k.r === 0) ? BODY_PAD : HULL_PAD, 0.36), hand }));
  if (display?.surface === "wells") {
    for (const { keys: group, hand } of bodies) {
      const columns = new Map<number, GeometryKey[]>();
      for (const key of group) if (key.r === 0) columns.set(key.x, [...(columns.get(key.x) ?? []), key]);
      for (const column of columns.values()) {
        const b = boardBounds(column);
        drawn.push({ kind: "well", d: roundedPath(rect(b.minX + 0.03, b.minY + 0.02, b.width - 0.06, b.height - 0.04), 0.3), hand });
      }
      for (const key of group) if (key.r !== 0) drawn.push({ kind: "well", d: roundedPath(grown(key, -0.02), 0.25), hand });
    }
  }
  return [...drawn, ...parts];
}

/**
 * The extent of the case's paths, so the canvas leaves room for a case that reaches well past the keys (the Moonlander's top edge and
 * tenting legs). Reads the absolute M, L, Q and A commands this file and display.case use; an arc counts its end point only.
 */
export function caseBounds(parts: readonly CasePart[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let box: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  const add = (x: number, y: number) => {
    box = box === null ? { minX: x, minY: y, maxX: x, maxY: y } : { minX: Math.min(box.minX, x), minY: Math.min(box.minY, y), maxX: Math.max(box.maxX, x), maxY: Math.max(box.maxY, y) };
  };
  for (const part of parts) {
    for (const [, command, args] of part.d.matchAll(/([MLQAZ])([^MLQAZ]*)/g)) {
      const n = (args ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (command === "A") {
        for (let i = 0; i + 6 < n.length; i += 7) add(n[i + 5] as number, n[i + 6] as number);
      } else {
        for (let i = 0; i + 1 < n.length; i += 2) add(n[i] as number, n[i + 1] as number);
      }
    }
  }
  return box;
}

// A case that hugs its keys: each upright key grown by `pad`, overlapping its neighbours so they fill as one shape with the steps of
// the columns kept, and each fan of keys turned about one point (a thumb cluster) as a curved band around that point.
function huggedCase(keys: readonly GeometryKey[], hands: Hands, pad: number, visible: (p: number) => boolean): CasePart[] {
  const parts: CasePart[] = [];
  for (const hand of ["left", "right"] as const) {
    const own = hands[hand].filter(visible).flatMap((p) => keys[p] ?? []);
    if (own.length === 0) continue;
    const upright = own.filter((key) => key.r === 0);
    const fans = new Map<string, GeometryKey[]>();
    for (const key of own) if (key.r !== 0) fans.set(`${key.rx},${key.ry}`, [...(fans.get(`${key.rx},${key.ry}`) ?? []), key]);
    const shapes = upright.map((key) => roundedPath(rect(key.x - pad, key.y - pad, key.w + 2 * pad, key.h + 2 * pad), pad * 1.2));
    for (const fan of fans.values()) shapes.push(fanBand(fan, pad));
    parts.push({ kind: "plate", d: shapes.join(" "), hand });
  }
  return parts;
}

// The annular sector around keys turned about one point, sampled every few degrees so it reads as a curve.
function fanBand(fan: readonly GeometryKey[], pad: number): string {
  const pivot = { x: fan[0]?.rx ?? 0, y: fan[0]?.ry ?? 0 };
  const polar = fan.flatMap(rotatedCorners).map((p) => ({ r: Math.hypot(p.x - pivot.x, p.y - pivot.y), a: Math.atan2(p.y - pivot.y, p.x - pivot.x) }));
  const inner = Math.max(0.1, Math.min(...polar.map((p) => p.r)) - pad);
  const outer = Math.max(...polar.map((p) => p.r)) + pad;
  // The pad along the arc is measured on the inner edge, so the band's ends clear the keys there too.
  const from = Math.min(...polar.map((p) => p.a)) - pad / inner;
  const to = Math.max(...polar.map((p) => p.a)) + pad / inner;
  const steps = Math.max(2, Math.ceil(((to - from) * 180) / Math.PI / 4));
  const at = (r: number, a: number): Point => ({ x: pivot.x + r * Math.cos(a), y: pivot.y + r * Math.sin(a) });
  const outerArc = Array.from({ length: steps + 1 }, (_, i) => at(outer, from + ((to - from) * i) / steps));
  const innerArc = Array.from({ length: steps + 1 }, (_, i) => at(inner, to - ((to - from) * i) / steps));
  // Each sample point rounds by at most half its short edges, so the arcs stay arcs and only the band's four ends visibly round.
  return roundedPath([...outerArc, ...innerArc], pad * 1.2);
}

function wells(keys: readonly GeometryKey[], hands: Hands, display: Display, visible: (p: number) => boolean): CasePart[] {
  if (display?.surface !== "wells") return [];
  const out: CasePart[] = [];
  for (const hand of ["left", "right"] as const) {
    const group = hands[hand].filter(visible).flatMap((p) => keys[p] ?? []);
    const columns = new Map<number, GeometryKey[]>();
    for (const key of group) if (key.r === 0) columns.set(key.x, [...(columns.get(key.x) ?? []), key]);
    for (const column of columns.values()) {
      const b = boardBounds(column);
      out.push({ kind: "well", d: roundedPath(rect(b.minX + 0.03, b.minY + 0.02, b.width - 0.06, b.height - 0.04), 0.3), hand });
    }
    for (const key of group) if (key.r !== 0) out.push({ kind: "well", d: roundedPath(grown(key, -0.02), 0.25), hand });
  }
  return out;
}
