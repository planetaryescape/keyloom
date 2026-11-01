import type { Database } from "bun:sqlite";
import { ReviewActivitiesSchema, ReviewWorkloadSchema, type ReviewActivity, type ReviewWorkload } from "../layout/review-workload.ts";

export function reviewActivities(db: Database, layoutId: string): ReviewActivity[] {
  const row = db.query("SELECT activities FROM review_workload_profiles WHERE layout_id = ?").get(layoutId) as { activities: string } | null;
  return row ? ReviewActivitiesSchema.parse(JSON.parse(row.activities)) : [];
}
export function setReviewActivities(db: Database, layoutId: string, activities: readonly ReviewActivity[]): void {
  const checked = ReviewActivitiesSchema.parse(activities);
  db.query("INSERT INTO review_workload_profiles (layout_id, activities) VALUES (?, ?) ON CONFLICT(layout_id) DO UPDATE SET activities = excluded.activities")
    .run(layoutId, JSON.stringify(checked));
}
export function reviewWorkload(db: Database, reviewId: string): ReviewWorkload | undefined {
  const row = db.query("SELECT evidence FROM review_workloads WHERE review_id = ?").get(reviewId) as { evidence: string } | null;
  return row ? ReviewWorkloadSchema.parse(JSON.parse(row.evidence)) : undefined;
}
export function saveReviewWorkload(db: Database, reviewId: string, evidence: ReviewWorkload): void {
  const checked = ReviewWorkloadSchema.parse(evidence);
  db.query("INSERT INTO review_workloads (review_id, evidence) VALUES (?, ?) ON CONFLICT(review_id) DO UPDATE SET evidence = excluded.evidence")
    .run(reviewId, JSON.stringify(checked));
}
export function clearReviewWorkload(db: Database, reviewId: string): void {
  db.query("DELETE FROM review_workloads WHERE review_id = ?").run(reviewId);
}
