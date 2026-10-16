// Whether a board is one body (a 60%, a laptop) or two halves (a Corne, a Moonlander). A one-piece board's keys still belong to
// hands, but it has no mirror image and a phone shows it whole instead of one half at a time (D-351).
import type { BoardDefinition, GeometryKey } from "./schema.ts";

// Halves closer than this are one row of keys that happens to be cut between two hands. The narrowest split shipped, the Moonlander,
// has 1u between its halves' key boxes.
const SPLIT_GAP = 0.5;

/**
 * A drawn case decides: any body or deck that belongs to no hand makes the board one piece. Without one, the gap between the hands'
 * key boxes does, measured square to the page so a tilted thumb cluster can't close it.
 */
export function isOnePiece(def: Pick<BoardDefinition, "hands" | "display">, keys: readonly GeometryKey[]): boolean {
  const drawn = def.display?.case;
  if (drawn !== undefined) return drawn.some((part) => part.hand === null && (part.kind === "body" || part.kind === "deck"));
  const dx = new Map<number, number>();
  for (const move of def.display?.shift ?? []) for (const p of move.positions) dx.set(p, (dx.get(p) ?? 0) + move.dx);
  const box = (p: number) => {
    const key = keys[p];
    return key === undefined ? null : { minX: key.x + (dx.get(p) ?? 0), maxX: key.x + key.w + (dx.get(p) ?? 0) };
  };
  const left = def.hands.left.flatMap((p) => box(p) ?? []);
  const right = def.hands.right.flatMap((p) => box(p) ?? []);
  if (left.length === 0 || right.length === 0) return true;
  return Math.min(...right.map((b) => b.minX)) - Math.max(...left.map((b) => b.maxX)) < SPLIT_GAP;
}
