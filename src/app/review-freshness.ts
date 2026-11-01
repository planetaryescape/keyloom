// Full review inputs: changes to constraints, board recipes or activities count even when the head ID is unchanged.
import { listDecisions } from "./decisions.ts";
import { getLayout } from "./layouts.ts";
import { workloadHash } from "./workload.ts";
import { reviewActivities } from "../persistence/review-workloads.ts";
import { REVIEW_CONTRACT_VERSION, type BoardReviewRow } from "../persistence/reviews.ts";
import type { App } from "./context.ts";

const snapshots = new WeakMap<App, Map<string, { stamp: string; key: string }>>();

export function reviewSnapshotKey(app: App, ref: string): string {
  const view = getLayout(app, ref);
  // Local and external SQLite writes both invalidate the cache. Board definitions are immutable for this process.
  const stamp = JSON.stringify([view.revision.id, app.db.query("SELECT total_changes() AS n").get(), app.db.query("PRAGMA data_version").get()]);
  const cache = snapshots.get(app) ?? new Map<string, { stamp: string; key: string }>();
  snapshots.set(app, cache);
  const saved = cache.get(view.layout.id);
  if (saved?.stamp === stamp) return saved.key;
  const decisions = listDecisions(app, view.layout.id).filter((d) => d.status !== "superseded" && d.status !== "retired")
    .map(({ id, kind, priorityKind, subject, goal, choice, reason, scope, status, outcomeNote }) => ({ id, kind, priorityKind, subject, goal, choice, reason, scope, status, outcomeNote }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const key = workloadHash({ contract: REVIEW_CONTRACT_VERSION, revision: view.revision.id, layout: view.document, board: view.board,
    decisions, activities: reviewActivities(app.db, view.layout.id) });
  cache.set(view.layout.id, { stamp, key });
  return key;
}

export function reviewFreshness(app: App, row: BoardReviewRow): { current: boolean; reason: string | null } {
  const reason = row.invalidatedReason ?? (row.contractVersion !== REVIEW_CONTRACT_VERSION ? "The review checks have changed. Run a fresh review."
    : row.snapshotKey !== reviewSnapshotKey(app, row.layoutId) ? "The config, constraints or board inputs changed. Run a fresh review." : null);
  return { current: reason === null, reason };
}
