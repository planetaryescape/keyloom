// What one agent turn did, for the per-turn log (11#logs). It holds names, durations and codes,
// never message text: the text is already in the database.
import type { ValidationResult } from "../validation/result.ts";

export type ToolCallTrace = { name: string; durationMs: number; ok: boolean };
export type ValidationFailureTrace = { tool: string; codes: string[] };

export class TurnRecorder {
  readonly toolCalls: ToolCallTrace[] = [];
  readonly validationFailures: ValidationFailureTrace[] = [];

  validation(tool: string, result: ValidationResult): void {
    if (!result.ok) this.validationFailures.push({ tool, codes: result.errors.map((e) => e.code) });
  }
}
