// The board's canvas in key units: its keys plus a margin, grown to cover a drawn case that reaches further. Pure, so the stage-fit
// test sizes every shipped board the way the editor does.
import type { GeometryKey } from "../../boards/schema.ts";
import { caseBounds, type CasePart } from "./case-shape.ts";
import { boardBounds, type Bounds } from "./geometry.ts";

// The margin leaves room for the case, which reaches past the keys, and for its shadow.
export const MARGIN = 0.6;
const CASE_MARGIN = 0.3;

/** `keys` are the keys on show (one hand on a phone's split view), `parts` the case drawn under them. */
export function canvasAround(keys: readonly GeometryKey[], parts: readonly CasePart[]): Bounds {
  const bounds = boardBounds(keys);
  // The margin around the keys holds most cases and their shadow; a case can reach further (the Moonlander's top edge and tenting
  // legs, a laptop's deck), so the canvas also covers the case itself plus room for its shadow.
  const drawnCase = caseBounds(parts);
  const minX = Math.min(bounds.minX - MARGIN, (drawnCase?.minX ?? Infinity) - CASE_MARGIN);
  const minY = Math.min(bounds.minY - MARGIN, (drawnCase?.minY ?? Infinity) - CASE_MARGIN);
  const maxX = Math.max(bounds.minX + bounds.width + MARGIN, (drawnCase?.maxX ?? -Infinity) + CASE_MARGIN);
  const maxY = Math.max(bounds.minY + bounds.height + MARGIN, (drawnCase?.maxY ?? -Infinity) + CASE_MARGIN);
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}
