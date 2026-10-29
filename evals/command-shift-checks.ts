// The checks the Command-Shift refine scenario makes over every valid proposal in a run (D-452), kept apart from the live test so a
// regression in them is caught by `bun test` without a model: a wrong first proposal followed by a right one must not pass.
import { applyOps } from "../src/layout/apply-ops.ts";
import type { ChangeOp } from "../src/layout/change.ts";
import type { Layout } from "../src/layout/schema.ts";

// Either side counts: right Command with right Shift is Command-Shift on a Mac, and a live run proposed exactly that (RGUI+RSFT).
const isCommandShift = (mods: readonly string[]): boolean => (mods.includes("LGUI") || mods.includes("RGUI")) && (mods.includes("LSFT") || mods.includes("RSFT"));

/** How many keys send Command-Shift as one key or hold it: counted, so a proposal is judged by what it adds and not by what the layout already had. */
export const commandShiftKeys = (doc: Layout): number =>
  doc.layers.flatMap((l) => l.bindings).filter((b) =>
    (b.kind === "modifier" && isCommandShift(b.mods)) ||
    (b.kind === "holdTap" && "mods" in b.hold && isCommandShift(b.hold.mods)),
  ).length;

export type ChainProposal = { ops: ChangeOp[]; validation: { diff: { displaced: readonly unknown[]; dropped: readonly unknown[] } } };

/** Both checks hold for every valid proposal in the chain, not for one of them. An empty chain passes neither. */
export function chainChecks(before: Layout, valid: readonly ChainProposal[]): { everyValidOneGivesCommandShift: boolean; displacedShown: boolean } {
  return {
    everyValidOneGivesCommandShift: valid.length > 0 && valid.every((p) => {
      const applied = applyOps(before, p.ops);
      return applied.ok && commandShiftKeys(applied.layout) > commandShiftKeys(before);
    }),
    // A valid proposal never loses a function silently; this checks each one showed what moves or what it gives up.
    displacedShown: valid.length > 0 && valid.every((p) => p.validation.diff.displaced.length + p.validation.diff.dropped.length > 0),
  };
}
