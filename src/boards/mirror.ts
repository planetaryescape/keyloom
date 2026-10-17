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

/**
 * What makes a mirror map unusable for "do that on the other hand too" (D-350). The agent reads the pairs both ways and gives the
 * partner the same hold, so a target used twice would lose a pair, and a pair across rows or fingers would put a home-row modifier on
 * the wrong key. Keys left out are fine: uneven thumb clusters and one-piece boards have keys with no partner.
 */
export function mirrorProblems(board: Pick<BoardDefinition, "mirror" | "hands" | "rows" | "fingers">): string[] {
  const problems: string[] = [];
  const left = new Set(board.hands.left);
  const right = new Set(board.hands.right);
  const rowOf = new Map<number, string>();
  for (const [name, positions] of Object.entries(board.rows)) for (const p of positions) rowOf.set(p, name);
  const finger = (p: number) => (board.fingers[String(p)] ?? "").replace(/^(left|right)-/, "");
  const targets = new Set<number>();
  for (const [from, to] of Object.entries(board.mirror)) {
    const f = Number(from);
    if (!left.has(f)) problems.push(`mirror source ${from} is not a left-hand position`);
    if (!right.has(to)) problems.push(`mirror target ${to} (from ${from}) is not a right-hand position`);
    if (targets.has(to)) problems.push(`mirror target ${to} is used twice`);
    targets.add(to);
    if (rowOf.get(f) !== rowOf.get(to)) problems.push(`mirror ${from} -> ${to} crosses rows ("${rowOf.get(f)}" and "${rowOf.get(to)}"); a pair is on one row`);
    if (finger(f) !== finger(to)) problems.push(`mirror ${from} -> ${to} pairs a ${finger(f) || "missing"} finger with a ${finger(to) || "missing"} finger`);
  }
  return problems;
}
