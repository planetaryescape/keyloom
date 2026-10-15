// Where a layer or hold key goes when the board it came from had keys this one lacks (21#copying-the-other-boards-setup-onto-it,
// D-234). A MacBook has one Space for both thumbs, so a Moonlander's thumb layer keys have no counterpart by function or place. The
// board lists the keys that can take a hold, best first; this offers them, and BK picks. Pure.
import type { BoardDefinition } from "./schema.ts";

export type Placement = { target: number; /** Whether another source key already maps onto it. */ taken: boolean };

/**
 * The candidates for one key with no counterpart: the board's preferred hold keys, in its order. `taken` marks a candidate
 * a matched key already lands on, so the proposal can say "this key is also typed Space" and not hide the clash.
 */
export function holdKeyCandidates(def: BoardDefinition, takenTargets: ReadonlySet<number>): Placement[] {
  return (def.holdKeyPreference ?? []).filter((p) => p < def.keyCount).map((target) => ({ target, taken: takenTargets.has(target) }));
}
