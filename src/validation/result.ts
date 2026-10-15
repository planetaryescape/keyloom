// The validator's output (docs/blueprint/07-change-validation.md). Issue codes are stable strings
// the agent and the editor both read.
import { z } from "zod";
import { SlotSchema } from "../layout/change.ts";

export const IssueSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  slots: z.array(SlotSchema).optional(),
});
export type Issue = z.infer<typeof IssueSchema>;

// Filled from rung 6 (08). Until then the validator always returns [].
export const DecisionReminderSchema = z.object({
  decisionId: z.string().min(1),
  summary: z.string().min(1),
});
export type DecisionReminder = z.infer<typeof DecisionReminderSchema>;

export const ValidationResultSchema = z.object({
  ok: z.boolean(),
  errors: z.array(IssueSchema),
  warnings: z.array(IssueSchema),
  diff: z.object({
    changed: z.array(SlotSchema),
    displaced: z.array(z.object({ function: z.string(), from: SlotSchema, to: SlotSchema.nullable() })),
    dropped: z.array(z.object({ function: z.string(), reason: z.string() })),
    relearnCount: z.number().int().nonnegative(),
    reminders: z.array(DecisionReminderSchema),
  }),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;
