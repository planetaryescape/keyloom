import { rotatedCorners } from "./geometry.ts";
import type { GeometryKey } from "../../boards/schema.ts";

export type Direction = "left" | "right" | "up" | "down";

interface Point {
  x: number;
  y: number;
}

function centre(key: GeometryKey): Point {
  const corners = rotatedCorners(key);
  return {
    x: corners.reduce((sum, p) => sum + p.x, 0) / corners.length,
    y: corners.reduce((sum, p) => sum + p.y, 0) / corners.length,
  };
}

/**
 * The key an arrow press should move to: the nearest key whose centre lies in that direction,
 * weighting sideways drift double so Up stays in its column. Staggered columns and the tilted
 * thumb clusters need no special cases. Null at an edge. `among` limits the search to the keys on screen.
 */
export function neighbour(keys: readonly GeometryKey[], from: number, direction: Direction, among: ReadonlySet<number> | null = null): number | null {
  const origin = keys[from];
  if (origin === undefined) return null;
  const here = centre(origin);
  let best: { index: number; score: number } | null = null;
  keys.forEach((key, index) => {
    if (index === from || (among !== null && !among.has(index))) return;
    const there = centre(key);
    const dx = there.x - here.x;
    const dy = there.y - here.y;
    const along = direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
    const across = direction === "left" || direction === "right" ? dy : dx;
    // A key must be clearly ahead, not merely beside, or Down from a short key would hop sideways.
    if (along < 0.3) return;
    const score = along + 2 * Math.abs(across);
    if (best === null || score < best.score) best = { index, score };
  });
  return (best as { index: number } | null)?.index ?? null;
}
