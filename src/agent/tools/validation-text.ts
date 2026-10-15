import type { ValidationResult } from "../../validation/result.ts";

/** The validator's result as the model reads it: codes and messages it can act on, and what the change touches. */
export function validationForModel(v: ValidationResult): string {
  return JSON.stringify({
    ok: v.ok,
    errors: v.errors,
    warnings: v.warnings,
    changedSlots: v.diff.changed,
    displaced: v.diff.displaced,
    dropped: v.diff.dropped,
    relearnCount: v.diff.relearnCount,
    retunedSlots: v.diff.retuned,
    // The words BK stored when he set this up. Quote them to him and ask whether they still hold.
    reminders: v.diff.reminders,
  });
}
