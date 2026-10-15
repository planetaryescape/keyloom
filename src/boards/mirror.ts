// The board's mirror map as the two-way lookup the agent and the editor use. board.json lists each
// left-hand position once (04); a mirror partner is the key at the same height on the other half.
import type { Hand } from "../layout/mirror.ts";
import type { BoardDefinition } from "./schema.ts";

/** Every position that has a partner, both directions: 0 -> 13 and 13 -> 0. */
export function mirrorPartners(board: Pick<BoardDefinition, "mirror">): Map<number, number> {
  const partners = new Map<number, number>();
  for (const [from, to] of Object.entries(board.mirror)) {
    partners.set(Number(from), to);
    partners.set(to, Number(from));
  }
  return partners;
}

export function handOfPosition(board: Pick<BoardDefinition, "hands">, position: number): Hand | null {
  if (board.hands.left.includes(position)) return "left";
  if (board.hands.right.includes(position)) return "right";
  return null;
}
