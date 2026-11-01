// Full review inputs: changes to constraints, board recipes or activities count even when the head ID is unchanged.
import { listDecisions } from "./decisions.ts";
import { getLayout } from "./layouts.ts";
import { workloadHash } from "./workload.ts";
import { reviewActivities } from "../persistence/review-workloads.ts";
import { REVIEW_CONTRACT_VERSION, type BoardReviewRow } from "../persistence/reviews.ts";
import type { App } from "./context.ts";

export function reviewSnapshotKey(app: App, ref: string): string {
  const view = getLayout(app, ref);
  return workloadHash({ contract: REVIEW_CONTRACT_VERSION, revision: view.revision.id, layout: view.document, board: view.board,
    decisions: listDecisions(app, view.layout.id), activities: reviewActivities(app.db, view.layout.id) });
}

export function reviewFreshness(app: App, row: BoardReviewRow): { current: boolean; reason: string | null } {
  const reason = row.invalidatedReason ?? (row.contractVersion !== REVIEW_CONTRACT_VERSION ? "The review checks have changed. Run a fresh review."
    : row.snapshotKey !== reviewSnapshotKey(app, row.layoutId) ? "The config, constraints or board inputs changed. Run a fresh review." : null);
  return { current: reason === null, reason };
}
