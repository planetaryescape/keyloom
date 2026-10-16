// Whether a board is one body (a 60%, a laptop) or two halves (a Corne, a Moonlander). A one-piece board's keys still belong to
// hands, but it has no mirror image and a phone shows it whole instead of one half at a time (D-351).
import type { BoardDefinition, GeometryKey } from "./schema.ts";

// Halves closer than this are one row of keys that happens to be cut between two hands. The narrowest split shipped, the Moonlander,
// has 1u between its halves' key boxes.
const SPLIT_GAP = 0.5;

/**
 * A drawn case decides: any body or deck that belongs to no hand makes the board one piece. Without one, the gap between the hands'
 * key boxes does, measured square to the page so a tilted thumb cluster can't close it. The editor passes the keys as drawn and
 * boards check the firmware's, which can't see display.shift; every shipped board gets the same answer from both (test/web/stage-fit).
 */
export function isOnePiece(def: Pick<BoardDefinition, "hands" | "display">, keys: readonly GeometryKey[]): boolean {
  const drawn = def.display?.case;
  if (drawn !== undefined) return drawn.some((part) => part.hand === null && (part.kind === "body" || part.kind === "deck"));
  const at = (positions: readonly number[]) => positions.flatMap((p) => keys[p] ?? []);
  const left = at(def.hands.left);
  const right = at(def.hands.right);
  if (left.length === 0 || right.length === 0) return true;
  return Math.min(...right.map((k) => k.x)) - Math.max(...left.map((k) => k.x + k.w)) < SPLIT_GAP;
}
