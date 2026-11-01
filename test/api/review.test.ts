import { expect, test } from "bun:test";
import { BoardReviewSchema, isReviewCurrent } from "../../src/api/review.ts";
import { createReview } from "../../src/app/review.ts";
import { groundedWorld } from "../helpers/grounded-review.ts";

test("wire reviews require explicit freshness; absent or false freshness is never current", () => {
  const w = groundedWorld();
  try {
    const { review } = createReview(w.app, w.layoutId, "manual");
    expect(BoardReviewSchema.safeParse(review).success).toBe(true);
    const { freshness: _, ...missing } = review;
    expect(BoardReviewSchema.safeParse(missing).success).toBe(false);
    expect(isReviewCurrent(missing, review.revisionId)).toBe(false);
    expect(isReviewCurrent({ ...review, freshness: { current: false } }, review.revisionId)).toBe(false);
    expect(isReviewCurrent(review, "old-head")).toBe(false);
    expect(isReviewCurrent(review, review.revisionId)).toBe(true);
  } finally { w.app.db.close(); }
});
