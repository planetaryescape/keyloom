import { expect, test } from "bun:test";
import { BoardReviewSchema, formatFindingRepairRequest, isReviewCurrent, selectableFinding } from "../../src/api/review.ts";
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

test("a scoped repair request names only the chosen finding and scope, without ops or implicit approval", () => {
  const request = formatFindingRepairRequest({
    title: "A does nothing",
    body: "Pressing it types nothing.",
    scope: ["Home row", "A on Home row", "Home row"],
  });
  expect(request).toContain("A does nothing");
  expect(request).toContain("Marked scope: Home row; A on Home row; Home row.");
  expect(request).toContain("Read the current review and layout first");
  expect(request).toContain("Do not apply it");
  expect(request).not.toContain("fix every");
  expect(request).not.toContain("{\"");
});

test("only visible problem or hint findings can be selected", () => {
  const w = groundedWorld();
  try {
    const { review } = createReview(w.app, w.layoutId, "manual");
    const item = review.items[0];
    expect(item).toBeDefined();
    if (!item) return;
    expect(selectableFinding([item], item.id)).toEqual(item);
    expect(selectableFinding([{ ...item, dismissedAt: Date.now() }], item.id)).toBeUndefined();
    expect(selectableFinding([{ ...item, kind: "suggestion" }], item.id)).toBeUndefined();
    expect(selectableFinding([item], "unknown")).toBeUndefined();
  } finally { w.app.db.close(); }
});
