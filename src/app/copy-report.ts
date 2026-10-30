// What a whole-config copy carried and what it did not, as the card under the reply reads it (D-467). It describes the plan the copy already
// made and never changes it: the same deterministic plan, the same validator, the same proposals. The artifact is bounded, and anything the
// bounds leave out is counted, so the card can say "and N more" instead of dropping it quietly.
import { z } from "zod";
import type { PutPlan } from "../agent/put-plan.ts";

/**
 * A card has room for a page, not a whole layout: at most these many rows of each kind. The counts beside them carry the rest.
 * The API's wire counterpart (`TransferArtifactSchema`) repeats these bounds; a contract test holds the two together.
 */
export const REPORT_LIMITS = { skipped: 40, layers: 12, notes: 8, combos: 12 } as const;
/** Longest text kept per field. A trimmed value ends in an ellipsis, so a reader can see it was cut. */
export const REPORT_TEXT = { board: 80, layer: 80, key: 80, reason: 120, combo: 40, note: 200 } as const;

export const TransferReportSchema = z.object({
  kind: z.literal("transfer"),
  sourceBoard: z.string().min(1).max(REPORT_TEXT.board),
  destinationBoard: z.string().min(1).max(REPORT_TEXT.board),
  /** Keys the plan carried over, including its nearest-place guesses. */
  mappedCount: z.number().int().nonnegative(),
  guessedCount: z.number().int().nonnegative(),
  /** The keys that did not come across, in the plan's order, bounded; `skippedCount` is how many there were. */
  skipped: z.array(z.object({
    key: z.string().min(1).max(REPORT_TEXT.key),
    reason: z.string().min(1).max(REPORT_TEXT.reason),
  })).max(REPORT_LIMITS.skipped),
  skippedCount: z.number().int().nonnegative(),
  layers: z.array(z.object({
    source: z.string().min(1).max(REPORT_TEXT.layer),
    target: z.string().min(1).max(REPORT_TEXT.layer),
    carried: z.number().int().nonnegative(),
    guessed: z.number().int().nonnegative(),
    notCarried: z.number().int().nonnegative(),
  })).max(REPORT_LIMITS.layers),
  layerCount: z.number().int().nonnegative(),
  combos: z.object({
    copied: z.number().int().nonnegative(),
    skipped: z.array(z.object({
      id: z.string().min(1).max(REPORT_TEXT.combo),
      why: z.string().min(1).max(REPORT_TEXT.reason),
    })).max(REPORT_LIMITS.combos),
    skippedCount: z.number().int().nonnegative(),
  }),
  /** What did not come with the keys at all: LED colours, firmware settings, passthrough code. */
  notes: z.array(z.string().min(1).max(REPORT_TEXT.note)).max(REPORT_LIMITS.notes),
  noteCount: z.number().int().nonnegative(),
  /** Layer keys that had no counterpart and a free key to go to, and those with nowhere to go. */
  placementCount: z.number().int().nonnegative(),
  placementsBlocked: z.number().int().nonnegative(),
});
export type TransferReport = z.infer<typeof TransferReportSchema>;

/** A value trimmed to its bound, visibly: the ellipsis is the reader's cue that there was more. */
const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

export type ReportNames = {
  sourceBoard: string;
  destinationBoard: string;
  /** The source layer's name by its id; the target keeps that name, so one lookup names both sides. */
  layerName: (id: string) => string;
};

/** Counts every drop, guess and placement the plan made, so the bound lists report what they left out. */
export function transferReport(plan: PutPlan, names: ReportNames): TransferReport {
  const carried = plan.layers.reduce((n, layer) => n + layer.carried, 0);
  const guessed = plan.layers.reduce((n, layer) => n + layer.guessed, 0);
  const placeable = plan.placements.filter((placement) => placement.blocked === undefined && placement.candidates.length > 0);
  const layerName = (id: string) => clip(names.layerName(id), REPORT_TEXT.layer);
  return {
    kind: "transfer",
    sourceBoard: clip(names.sourceBoard, REPORT_TEXT.board),
    destinationBoard: clip(names.destinationBoard, REPORT_TEXT.board),
    mappedCount: carried,
    guessedCount: guessed,
    skipped: plan.notCarried.slice(0, REPORT_LIMITS.skipped).map((key) => ({
      key: clip(`${key.sourceName} (${key.layerName})`, REPORT_TEXT.key),
      reason: clip(key.why, REPORT_TEXT.reason),
    })),
    skippedCount: plan.notCarried.length,
    layers: plan.layers.slice(0, REPORT_LIMITS.layers).map((layer) => ({
      source: layerName(layer.source), target: layerName(layer.target),
      carried: layer.carried, guessed: layer.guessed, notCarried: layer.notCarried,
    })),
    layerCount: plan.layers.length,
    combos: {
      copied: plan.combos.copied.length,
      skipped: plan.combos.skipped.slice(0, REPORT_LIMITS.combos).map((combo) => ({ id: clip(combo.id, REPORT_TEXT.combo), why: clip(combo.why, REPORT_TEXT.reason) })),
      skippedCount: plan.combos.skipped.length,
    },
    notes: plan.notes.slice(0, REPORT_LIMITS.notes).map((note) => clip(note, REPORT_TEXT.note)),
    noteCount: plan.notes.length,
    placementCount: placeable.length,
    placementsBlocked: plan.placements.length - placeable.length,
  };
}
