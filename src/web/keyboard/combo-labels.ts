// Where a combo's output label goes (18#a-keycap-shows-every-slot-it-has). Caps fill the board edge to
// edge, so the middle of a combo's line is usually on top of a legend. The label looks for the nearest
// spot, along the line and out to either side of it, that covers none; only when there is no such spot
// does it cover some, and the caller fades those legends rather than let the two be read together.
// Pure, so the search is tested without a browser; the viewer measures the legends in the DOM.
import type { Point } from "./geometry.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export interface Placement {
  /** The label's centre. */
  at: Point;
  /** Indexes of the obstacles the label still covers; empty when it found a clear spot. */
  covers: number[];
}

// How far the search goes along the line (as a share of its length) and out from it (in key units).
const ALONG = [0, -0.1, 0.1, -0.2, 0.2, -0.3, 0.3, -0.4, 0.4];
const OUT = [0, 0.35, -0.35, 0.5, -0.5, 0.65, -0.65];

/**
 * The spot for a label of `size` near `ideal`. `along` is a unit vector in the line's direction, `length` its
 * length in px and `unit` the key size in px. `obstacles` are the legends (and earlier labels) to keep clear of.
 */
export function placeLabel(ideal: Point, along: Point, length: number, unit: number, size: { w: number; h: number }, obstacles: readonly Rect[]): Placement {
  const across = { x: -along.y, y: along.x };
  let best: Placement | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const out of OUT) {
    for (const step of ALONG) {
      const at = { x: ideal.x + along.x * step * length + across.x * out * unit, y: ideal.y + along.y * step * length + across.y * out * unit };
      const box = { x: at.x - size.w / 2, y: at.y - size.h / 2, w: size.w, h: size.h };
      const covers: number[] = [];
      let area = 0;
      obstacles.forEach((obstacle, index) => {
        const hit = overlapArea(box, obstacle);
        if (hit > 0) {
          covers.push(index);
          area += hit;
        }
      });
      // A clear spot always beats a covering one; among equals the nearest to the line's middle wins.
      const cost = (covers.length > 0 ? 1_000_000 + area : 0) + Math.hypot(at.x - ideal.x, at.y - ideal.y);
      if (cost < bestCost) {
        bestCost = cost;
        best = { at, covers };
      }
    }
  }
  return best ?? { at: ideal, covers: [] };
}
