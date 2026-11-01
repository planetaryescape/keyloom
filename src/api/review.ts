// The board review (D-340): what keyloom found in a config's head revision, shown without being asked for. The checks fill in at once;
// the agent's part arrives after, announced on the events stream. `:ref` is a config's ID or exact name, as for /api/configs.
//   GET  /api/layouts/:ref/review                       -> ReviewResponse (the newest review, whatever revision it was of; `review` is null before any)
//   POST /api/layouts/:ref/review/run   RunReviewRequest -> ReviewResponse (202: the checks of the head are in; `ai.status` says what is still coming)
//   POST /api/layouts/:ref/review/items/:id/dismiss {}   -> ReviewResponse (404 for an id the latest review doesn't have)
//   POST /api/layouts/:ref/review/items/:id/restore {}   -> ReviewResponse
//   GET  /api/events: besides `event: sync` frames, an `event: review` frame (ReviewEvent) whenever a review is made or its agent part changes
// A review is stale while `review.revisionId` differs from `headRevisionId`. `:id` is an item's stable id, URL-encoded.
import { z } from "zod";
import { FixedItemSchema, ReviewItemSchema } from "../validation/review-item.ts";
import { ReviewActivitiesSchema, ReviewWorkloadSchema } from "../layout/review-workload.ts";
export { ReviewActivitiesSchema, REVIEW_ACTIVITIES, REVIEW_ACTIVITY_LABELS, workloadVerdictWords, type ReviewActivity } from "../layout/review-workload.ts";

export const AiStatusSchema = z.enum(["pending", "running", "done", "unavailable", "failed"]);

export const BoardReviewSchema = z.object({
  id: z.string().min(1),
  layoutId: z.string().min(1),
  /** The revision it is about; one review per revision. */
  revisionId: z.string().min(1),
  trigger: z.enum(["connect", "apply", "import", "manual"]),
  checkedAt: z.number().finite(),
  checks: z.object({ status: z.literal("done"), summary: z.object({ layers: z.number().int(), keys: z.number().int(), combos: z.number().int() }) }),
  ai: z.object({
    status: AiStatusSchema,
    /** In words, when the agent's part is unavailable or failed: "No model provider is set up." */
    reason: z.string().nullable(),
    model: z.string().nullable(),
  }),
  workload: ReviewWorkloadSchema.optional(),
  /** Every item, hidden ones included with `dismissedAt` set. Checks first, then the agent's. */
  items: z.array(ReviewItemSchema),
  /** What the previous review had that this revision no longer produces; each says which review it is fixed since. */
  fixed: z.array(FixedItemSchema),
});
export type BoardReview = z.infer<typeof BoardReviewSchema>;

export const ReviewResponseSchema = z.object({
  layoutId: z.string().min(1),
  headRevisionId: z.string().min(1),
  review: BoardReviewSchema.nullable(),
  workloadActivities: ReviewActivitiesSchema.optional(),
});
export type ReviewResponse = z.infer<typeof ReviewResponseSchema>;

/** `activities` saves the profile ([] disables tests); like `force`, supplying it reruns a finished review. Omit it to keep the profile. */
export const RunReviewRequestSchema = z.object({ force: z.boolean().optional(), activities: ReviewActivitiesSchema.optional() }).strict();

export const ReviewEventSchema = z.object({
  type: z.literal("review"),
  layoutId: z.string().min(1),
  revisionId: z.string().min(1),
  reviewId: z.string().min(1),
  aiStatus: AiStatusSchema,
});
export type ReviewEvent = z.infer<typeof ReviewEventSchema>;

/**
 * What "Fix issues" asks the agent (D-461). One plain sentence, used by the review panel and `keyloom review fix`, so the two surfaces
 * ask the same thing. It carries no instructions: the system prompt says to read the review with `get_review` and answer with one change,
 * and the findings themselves are read at run time, so they cannot drift from the stored review and the visible request stays short.
 */
export const REVIEW_FIX_REQUEST = "Fix what the board review found in this config.";
