// The validator's output (docs/blueprint/07-change-validation.md). Issue codes are stable strings
// the agent and the editor both read.
import { z } from "zod";
import { SlotSchema } from "../layout/change.ts";

export const IssueSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  slots: z.array(SlotSchema).optional(),
  // The same finding in words for the person at the editor (D-101): layer names and 1-based key
  // numbers, no ids. `message` stays as it was for the CLI's JSON and the logs. Optional because
  // results stored before this field existed don't have it.
  plain: z.string().min(1).optional(),
  // For function_lost: the canonical function string, so the editor can offer to drop or place it.
  function: z.string().min(1).optional(),
  // For layer_unreachable and layer_trap: the layer, so the editor can tell that dropping a layer key won't help.
  layerId: z.string().min(1).optional(),
});
export type Issue = z.infer<typeof IssueSchema>;

// A remembered reason the change brushes against (08). It carries the words stored with the
// decision, so the preview can show them without a second lookup.
export const DecisionReminderSchema = z.object({
  decisionId: z.string().min(1),
  goal: z.string().min(1),
  choice: z.string().min(1),
  reason: z.string().min(1),
  // A decision marked tried_unhelpful raises no reminder: there is nothing left to protect (D-053).
  status: z.enum(["hypothesis", "tried_helpful"]),
  /** The decision's keys this change touches, so the preview can mark them. */
  slots: z.array(SlotSchema),
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
    // Keys whose binding is the same but whose hold-tap feel changed (a profile or a tap-hold setting).
    // Older stored results have none, so it defaults.
    retuned: z.array(SlotSchema).default([]),
    reminders: z.array(DecisionReminderSchema),
  }),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;
