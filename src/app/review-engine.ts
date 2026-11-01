// The board review's triggers (D-340, D-474). Every tick checks saved input freshness; device observations also invalidate immediately.
// A revision can be analyzed again after a genuine reconnect or changed inputs. Stable polling reuses only the current snapshot.
//   - connect: the config on a board's keyboard when it connects, reconnects, or its observed firmware identity changes;
//   - apply / import: a head made since the engine started, once the quiet time has passed with no further change.
// A config that was not touched and whose keyboard is away is left alone; `POST /review/run` and `keyloom review --run` cover it.
import { findRevision, listLayoutRows } from "../persistence/layouts.ts";
import { listChangeSets } from "../persistence/change-sets.ts";
import { reviewActivities } from "../persistence/review-workloads.ts";
import { failOrphanedRuns, findReviewOfRevision, invalidateReview, latestReview, REVIEW_CONTRACT_VERSION } from "../persistence/reviews.ts";
import { transact } from "../persistence/transaction.ts";
import { reviewFreshness } from "./review-freshness.ts";
import type { App } from "./context.ts";
import type { ReviewActivity } from "../layout/review-workload.ts";
import { saveReviewActivities } from "./review-workloads.ts";
import {
  type BoardReview, type ReviewAiDeps, type ReviewEvent, type ReviewTrigger, type ReviewView, createReview, dismissReviewItem, restoreReviewItem, runReviewAi, showReview,
} from "./review.ts";
import type { BoardSyncView } from "./sync-engine.ts";

export type ReviewOptions = {
  /** How long after the last change a review starts (default 3 s, the sync engine's quiet time). */
  quietMs?: number;
  /** How often it looks at the database (default 1 s). */
  tickMs?: number;
  now?: () => number;
};

/** What the engine needs of the sync engine: to be told when a board's state changes. */
export interface BoardWatcher {
  subscribe(listener: (boards: BoardSyncView[]) => void): () => void;
}

export class ReviewEngine {
  private readonly quietMs: number;
  private readonly tickMs: number;
  private readonly now: () => number;
  private readonly listeners = new Set<(event: ReviewEvent) => void>();
  /** Config IDs whose board has its keyboard connected, from the sync engine's last view. */
  private connected = new Set<string>();
  private readonly freshConnections = new Set<string>();
  private deviceKeys = new Map<string, string | undefined>();
  private readonly observed = new Set<string>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly active = new Map<string, { reviewId: string; done: Promise<BoardReview> }>();
  private unwatch: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<unknown> = Promise.resolve();
  private startedAt = Number.POSITIVE_INFINITY;
  private stopping = false;
  private started = false;
  private failure: string | undefined;
  private readonly running = new Set<Promise<unknown>>();
  private readonly abort = new AbortController();

  constructor(private readonly app: App, private readonly deps: ReviewAiDeps, opts: ReviewOptions = {}) {
    this.quietMs = opts.quietMs ?? 3000;
    this.tickMs = opts.tickMs ?? 1000;
    this.now = opts.now ?? Date.now;
  }

  /** Follows the sync engine's boards for the connect trigger, and starts ticking. `watch` is subscribed before the sync engine starts, so its first view is seen. */
  start(watch?: BoardWatcher): void {
    if (this.started) return;
    this.started = true;
    this.startedAt = this.now();
    // A run that was going when the last process died will never finish; saying so ends the screen's waiting.
    failOrphanedRuns(this.app.db, "keyloom was closed while it was looking. It will look again after your next change.");
    this.unwatch = watch?.subscribe((boards) => {
      const next = new Set(boards.filter((b) => b.state.kind !== "not_connected").map((b) => b.layoutId));
      for (const board of boards) {
        const id = board.layoutId;
        const changed = this.observed.has(id) && next.has(id) && (!this.connected.has(id) || this.deviceKeys.get(id) !== board.reviewDeviceKey);
        this.observed.add(id);
        const disconnected = this.connected.has(id) && !next.has(id);
        if (changed || disconnected) {
          if (changed) this.freshConnections.add(id);
          else this.freshConnections.delete(id);
          this.invalidate(id, disconnected ? "The keyboard disconnected. Recommendations will be reanalyzed when it reconnects."
            : "The keyboard connected or its observed firmware changed. A fresh analysis is required.");
        }
      }
      for (const id of this.connected) if (!boards.some((board) => board.layoutId === id)) {
        this.freshConnections.delete(id);
        this.invalidate(id, "The keyboard or its active config changed. Run a fresh review.");
      }
      this.deviceKeys = new Map(boards.map((b) => [b.layoutId, b.reviewDeviceKey]));
      this.connected = next;
      void this.tick();
    });
    this.schedule();
  }

  /** Stops ticking and ends a model call in flight; the review it was making is left `failed`. */
  async stop(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.timer);
    this.unwatch?.();
    this.abort.abort();
    await Promise.allSettled([...this.running, this.chain]);
  }

  subscribe(listener: (event: ReviewEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private readonly emit = (event: ReviewEvent): void => {
    for (const l of this.listeners) l(event);
  };

  private invalidate(layoutId: string, reason: string): void {
    this.controllers.get(layoutId)?.abort();
    const review = latestReview(this.app.db, layoutId);
    if (!review) return;
    transact(this.app.db, () => invalidateReview(this.app.db, review.id, reason));
    this.emit({ type: "review", layoutId, revisionId: review.revisionId, reviewId: review.id, aiStatus: "failed" });
  }

  private schedule(): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => void this.tick().finally(() => this.schedule()), this.tickMs);
  }

  /** One look at the database for a head that should be reviewed. Tests call it with a clock they hold. */
  tick(): Promise<void> {
    // Never rejects: it runs from timers and a subscription, and the engine is a guest in the server.
    const next = this.chain.then(async () => {
      if (this.stopping) return;
      try {
        for (const layout of listLayoutRows(this.app.db)) {
          if (this.stopping) return;
          const previous = latestReview(this.app.db, layout.id);
          if (previous && previous.invalidatedReason === null) {
            const freshness = reviewFreshness(this.app, previous);
            if (!freshness.current) this.invalidate(layout.id, freshness.reason ?? "Review inputs changed.");
          }
          const trigger = this.triggerFor(layout);
          if (trigger === undefined) continue;
          const force = this.freshConnections.delete(layout.id);
          const { done } = this.review(layout.id, trigger, { force });
          // One at a time: a model call per tick keeps a burst of imports from becoming a burst of bills.
          await done;
        }
        this.failure = undefined;
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        if (text !== this.failure) console.error(`keyloom: board review could not run: ${text}`);
        this.failure = text;
      }
    });
    this.chain = next.catch(() => undefined);
    return next;
  }

  private triggerFor(layout: ReturnType<typeof listLayoutRows>[number]): ReviewTrigger | undefined {
    if (layout.archivedAt !== null) return undefined;
    const existing = findReviewOfRevision(this.app.db, layout.id, layout.headRevisionId);
    if (existing && !this.freshConnections.has(layout.id)) {
      if (reviewFreshness(this.app, existing).current) return undefined;
      // An upgrade alone does not authorize a provider call. Connect or an explicit rerun does.
      if (existing.contractVersion !== REVIEW_CONTRACT_VERSION || (!this.connected.has(layout.id) && existing.invalidatedReason !== null)) return undefined;
    }
    // Wait for the change to settle: a run of Applies is one review, of the last of them.
    if (this.now() - layout.updatedAt < this.quietMs) return undefined;
    // A head made since the server started was caused by the change, even when the keyboard is connected; "connect" is for a head that
    // was already there when the keyboard appeared.
    const saved = findRevision(this.app.db, layout.id, layout.headRevisionId);
    const head = saved?.revision;
    // A put starts on an empty config with a mapping waiting for Apply. Test the copied keys, not that temporary blank.
    if (head?.origin === "import" && saved?.layout.layers.every((layer) => layer.bindings.every((binding) => binding.kind === "none" || binding.kind === "transparent"))
      && reviewActivities(this.app.db, layout.id).length > 0
      && listChangeSets(this.app.db, layout.id, { status: "proposed" }).some((change) => change.baseRevisionId === head.id && change.proposalGroup !== null && change.conversationId === null)) return undefined;
    if (head !== undefined && head.createdAt >= this.startedAt) return head.origin === "import" ? "import" : "apply";
    return this.connected.has(layout.id) ? "connect" : undefined;
  }

  // --- what the routes and the CLI call -----------------------------------------------------

  show(ref: string): ReviewView {
    return showReview(this.app, ref);
  }

  /**
   * The current snapshot's checks, returned as soon as stored; `done` settles when the agent's part has too. Changed inputs revoke
   * the old review first. An unchanged finished snapshot is reused unless `force` requests another look.
   * Supplying `activities` saves that profile ([] disables tests) and forces a rerun even when unchanged; omitting it keeps the profile.
   */
  review(ref: string, trigger: ReviewTrigger, opts: { force?: boolean; activities?: ReviewActivity[]; signal?: AbortSignal } = {}): { review: BoardReview; done: Promise<BoardReview> } {
    if (opts.activities !== undefined) saveReviewActivities(this.app, ref, opts.activities);
    const force = opts.force === true || opts.activities !== undefined;
    const hooks = { emit: this.emit, now: this.now };
    const { review } = createReview(this.app, ref, trigger, hooks);
    const active = this.active.get(review.layoutId);
    if (active?.reviewId === review.id && review.ai.status === "running" && !this.controllers.get(review.layoutId)?.signal.aborted) return { review, done: active.done };
    if (review.ai.status === "done" && !force) return { review, done: Promise.resolve(review) };
    this.controllers.get(review.layoutId)?.abort();
    const controller = new AbortController();
    this.controllers.set(review.layoutId, controller);
    const signal = AbortSignal.any([this.abort.signal, controller.signal, ...(opts.signal ? [opts.signal] : [])]);
    const done = runReviewAi(this.app, review.id, this.deps, { ...hooks, ...(force ? { force: true } : {}), signal });
    this.active.set(review.layoutId, { reviewId: review.id, done });
    this.running.add(done);
    void done.finally(() => {
      this.running.delete(done);
      if (this.controllers.get(review.layoutId) === controller) {
        this.controllers.delete(review.layoutId);
        this.active.delete(review.layoutId);
      }
    }).catch(() => undefined);
    return { review, done };
  }

  dismiss(ref: string, itemId: string): ReviewView {
    return dismissReviewItem(this.app, ref, itemId, this.now);
  }

  restore(ref: string, itemId: string): ReviewView {
    return restoreReviewItem(this.app, ref, itemId);
  }
}
