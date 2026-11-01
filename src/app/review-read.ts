// Reading a stored board review (D-340): the newest review of a config as the screen and the agent see it, and its markers written as
// words. It is its own file because the agent's ports read a review, and review.ts is the module that builds one and calls the ports.
import type { ReviewFinding, ReviewFindings } from "../agent/ports.ts";
import { keyName } from "../boards/key-names.ts";
import { layerDisplayName } from "../layout/cap-words.ts";
import type { ReviewActivity, ReviewWorkload } from "../layout/review-workload.ts";
import { type ChangeSetRow, findChangeSet } from "../persistence/change-sets.ts";
import { findLayoutRow } from "../persistence/layouts.ts";
import { reviewActivities, reviewWorkload } from "../persistence/review-workloads.ts";
import {
   type AiStatus, type BoardReviewRow, type ReviewItemRow, type ReviewTrigger, dismissals, latestReview, listReviewItems, reviewBehavior,
} from "../persistence/reviews.ts";
import { type FixedItem, type ReviewItem } from "../validation/review-item.ts";
import type { App } from "./context.ts";
import { NotFoundError } from "./errors.ts";
import { getLayout } from "./layouts.ts";
import { reviewFreshness } from "./review-freshness.ts";
import type { BehaviorEvidence } from "../layout/review-evidence.ts";

export type BoardReview = {
  id: string;
  layoutId: string;
  revisionId: string;
  trigger: ReviewTrigger;
  checkedAt: number;
  checks: { status: "done"; summary: { layers: number; keys: number; combos: number } };
  ai: { status: AiStatus; reason: string | null; model: string | null };
  workload?: ReviewWorkload;
  freshness?: { current: boolean; reason: string | null };
  behavior?: Array<BehaviorEvidence & { proposalId: string }>;
  /** Hidden items are in the list with `dismissedAt` set, so the screen can count them and offer them back. */
  items: ReviewItem[];
  /** What the previous review had that this revision no longer produces, each saying which review it was fixed since. */
  fixed: FixedItem[];
};

export type ReviewView = {
  layoutId: string;
  /** The config's head now. The review is stale while its `revisionId` differs. */
  headRevisionId: string;
  /** The newest review of the config, or null when none has run. */
  review: BoardReview | null;
  workloadActivities?: ReviewActivity[];
};

export const itemOf = (row: ReviewItemRow, hidden: ReadonlyMap<string, number>): ReviewItem => ({ ...row, dismissedAt: hidden.get(row.id) ?? null });

export function toReview(app: App, row: BoardReviewRow): BoardReview {
  const hidden = dismissals(app.db, row.layoutId);
  const workload = reviewWorkload(app.db, row.id);
  const freshness = reviewFreshness(app, row);
  return {
    id: row.id, layoutId: row.layoutId, revisionId: row.revisionId, trigger: row.trigger, checkedAt: row.checkedAt,
    checks: { status: "done", summary: row.summary },
    ai: { status: row.ai.status, reason: row.ai.reason, model: row.ai.model },
    freshness,
    ...(freshness.current ? { behavior: reviewBehavior(app.db, row) } : {}),
    ...(workload && freshness.current ? { workload } : {}),
    items: listReviewItems(app.db, row.id).filter((r) => freshness.current || r.source === "check").map((r) => itemOf(r, hidden)),
    fixed: row.fixed.flatMap((f) => (row.previousReviewId === null || f.source !== "check" ? [] : [{ ...itemOf(f, hidden), fixedSince: row.previousReviewId }])),
  };
}

export function showReview(app: App, ref: string): ReviewView {
  const layout = findLayoutRow(app.db, ref);
  if (!layout) throw new NotFoundError(`no layout "${ref}"`);
  const row = latestReview(app.db, layout.id);
  const activities = reviewActivities(app.db, layout.id);
  return { layoutId: layout.id, headRevisionId: layout.headRevisionId, review: row ? toReview(app, row) : null, ...(activities.length ? { workloadActivities: activities } : {}) };
}

/**
 * A title or body with its key and layer markers written as words, for the CLI: "S hold ⌥ (left ring, home row, Layer 0)" and "Magic layer".
 * The review's own revision is read, so a review of an older version still names its keys as they were.
 */
function wordsFor(app: App, review: BoardReview): (text: string) => string {
  const view = getLayout(app, review.layoutId, review.revisionId);
  return (text) =>
    text.replace(/\{(key|layer):([^{}:]+)(?::(\d+))?\}/g, (whole, kind: string, layerId: string, position: string | undefined) => {
      const layer = view.document.layers.find((l) => l.id === layerId);
      if (layer === undefined) return whole;
      if (kind === "layer" || position === undefined) return layerDisplayName(layer.name);
      return keyName(view.board.definition, view.document, { layerId, position: Number(position) }, { geometry: view.board.geometry });
    });
}

export function reviewWords(app: App, review: BoardReview, text: string): string {
  return wordsFor(app, review)(text);
}

/** A suggestion's change set as the agent can use it: its ops only while it is still the proposal on the board (D-461). */
function proposalOf(row: ChangeSetRow | undefined, id: string): ReviewFinding["proposal"] {
  if (row === undefined) return { id, title: null, status: "missing", ops: null };
  // The card's fallback title (`toCard`, src/app/proposal-card.ts), so the two never describe one change differently.
  const title = row.title ?? row.explanation.slice(0, 80);
  if (row.status !== "proposed") return { id, title, status: row.status, ops: null };
  return { id, title, status: null, ops: row.ops };
}

/**
 * The newest review of a config with the findings BK has not hidden, in the form the agent acts on (D-461): plain words (no markers),
 * the keys by position, and a suggestion's proposal with the ops that still apply. Findings he hid are his decision, so they are
 * counted and left out.
 */
export function reviewFindings(app: App, ref: string): ReviewFindings {
  const view = showReview(app, ref);
  const review = view.review;
  if (review === null) return { layoutId: view.layoutId, headRevisionId: view.headRevisionId, review: null };
  const words = wordsFor(app, review);
  const shown = review.items.filter((item) => item.dismissedAt === null);
  return {
    layoutId: view.layoutId,
    headRevisionId: view.headRevisionId,
    review: {
      id: review.id,
      revisionId: review.revisionId,
      trigger: review.trigger,
      checkedAt: review.checkedAt,
      ai: { status: review.ai.status, reason: review.ai.reason },
      current: review.revisionId === view.headRevisionId && review.freshness?.current !== false,
      freshnessReason: review.freshness?.reason ?? null,
      items: shown.map((item) => ({
        id: item.id,
        source: item.source,
        kind: item.kind,
        severity: item.severity,
        title: words(item.title),
        body: words(item.body),
        keys: item.keys,
        layers: item.layers,
        fixes: item.fixes,
        proposal: item.proposalId === null ? null : proposalOf(findChangeSet(app.db, item.proposalId), item.proposalId),
      })),
      hidden: review.items.length - shown.length,
    },
  };
}
