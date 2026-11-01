// Shared review evidence contract. Counts describe selected firmware witnesses, not human performance.
import { z } from "zod";

export const REVIEW_ACTIVITIES = ["prose", "typescript", "python", "json", "shell", "shortcuts"] as const;
export const ReviewActivitySchema = z.enum(REVIEW_ACTIVITIES);
export type ReviewActivity = z.infer<typeof ReviewActivitySchema>;
export const ReviewActivitiesSchema = z.array(ReviewActivitySchema).max(REVIEW_ACTIVITIES.length)
  .refine((ids) => new Set(ids).size === ids.length, "choose each activity once");
export const REVIEW_ACTIVITY_LABELS: Record<ReviewActivity, string> = {
  prose: "Writing", typescript: "TypeScript", python: "Python", json: "JSON", shell: "Terminal", shortcuts: "Shortcuts",
};
const count = z.number().int().nonnegative();
export const ReviewWorkloadTaskSchema = z.object({
  id: z.string(), status: z.enum(["unsupported", "no-route-within-supported-subset", "search-limit", "verified", "output-mismatch", "warning-tainted", "execution-error"]), requestedOutputs: count,
  physicalKeydowns: count.nullable(), maxSimultaneousKeys: count.nullable(),
  layerEntries: count.nullable(), modifierEntries: count.nullable(),
  busyKeys: z.array(z.object({ position: count, keydowns: count })).max(6),
});
export const ReviewWorkloadComparisonSchema = z.object({
  proposalId: z.string(), patchHash: z.string().nullable(),
  verdict: z.enum(["verified-improvement", "equivalent", "regression", "tradeoff", "inconclusive", "not-tested"]),
  reason: z.string().nullable(),
  tasks: z.array(ReviewWorkloadTaskSchema),
  deltas: z.array(z.object({ id: z.string(), physicalKeydowns: z.number().int().nullable(), maxSimultaneousKeys: z.number().int().nullable() })),
});
export type ReviewWorkloadComparison = z.infer<typeof ReviewWorkloadComparisonSchema>;
export const ReviewWorkloadSchema = z.object({
  status: z.enum(["pending", "running", "done", "unavailable", "failed"]),
  activities: ReviewActivitiesSchema, reason: z.string().nullable(),
  identity: z.object({
    revisionId: z.string(), layoutHash: z.string(), boardHash: z.string(), boardRevision: z.string(),
    suiteHash: z.string(), policyHash: z.string(), sourceHash: z.string().nullable(),
    evaluator: z.string(), planner: z.string(), host: z.string(), generator: z.string(), firmwarePin: z.string(), buildRecipeHash: z.string(),
  }).nullable(),
  baseline: z.array(ReviewWorkloadTaskSchema),
  comparisons: z.array(ReviewWorkloadComparisonSchema),
});
export type ReviewWorkload = z.infer<typeof ReviewWorkloadSchema>;

export const workloadVerdictWords: Record<ReviewWorkloadComparison["verdict"], string> = {
  "verified-improvement": "Fewer presses or a smaller chord; no tested task costs more",
  equivalent: "No measured improvement", regression: "Costs more on the selected tasks",
  tradeoff: "Helps one measure, costs more on another", inconclusive: "Not enough verified evidence", "not-tested": "Not tested",
};

export function reviewTaskLabel(id: string): string {
  if (id === "shortcuts-copy-control") return "Copy (Control-C)";
  if (id === "shortcuts-command-palette") return "Command-Shift-P";
  if (id === "shortcuts-navigation") return "Left and right arrows";
  const activity = REVIEW_ACTIVITIES.find((name) => id === `${name}-${name}`);
  return activity ? `${REVIEW_ACTIVITY_LABELS[activity]} sample` : id;
}
