// The board review's triggers (D-340). Like the sync engine it is level-triggered: every tick it asks, from the database and the
// sync engine's last reading of USB, "which head has no review and should?", so a burst of Applies, a restart and a keyboard that
// comes back are the same question with different answers. A revision with a review is never asked about again.
//   - connect: the config on a board's keyboard, when that keyboard is connected and the head has no review;
//   - apply / import: a head made since the engine started, once the quiet time has passed with no further change.
// A config that was not touched and whose keyboard is away is left alone; `POST /review/run` and `keyloom review --run` cover it.
import { findRevision, listLayoutRows } from "../persistence/layouts.ts";
import { failOrphanedRuns, findReviewOfRevision } from "../persistence/reviews.ts";
import type { App } from "./context.ts";
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
      this.connected = new Set(boards.filter((b) => b.state.kind !== "not_connected").map((b) => b.layoutId));
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
          const trigger = this.triggerFor(layout);
          if (trigger === undefined) continue;
          const { done } = this.review(layout.id, trigger);
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
    if (findReviewOfRevision(this.app.db, layout.id, layout.headRevisionId)) return undefined;
    // Wait for the change to settle: a run of Applies is one review, of the last of them.
    if (this.now() - layout.updatedAt < this.quietMs) return undefined;
    if (this.connected.has(layout.id)) return "connect";
    const head = findRevision(this.app.db, layout.id, layout.headRevisionId)?.revision;
    if (head === undefined || head.createdAt < this.startedAt) return undefined;
    return head.origin === "import" ? "import" : "apply";
  }

  // --- what the routes and the CLI call -----------------------------------------------------

  show(ref: string): ReviewView {
    return showReview(this.app, ref);
  }

  /**
   * The checks for the head now, returned as soon as they are stored; `done` settles when the agent's part has too. A revision
   * that has a review keeps it: only an agent part that was missing or failed runs again, or any with `force`.
   */
  review(ref: string, trigger: ReviewTrigger, opts: { force?: boolean } = {}): { review: BoardReview; done: Promise<BoardReview> } {
    const hooks = { emit: this.emit, now: this.now };
    const { review } = createReview(this.app, ref, trigger, hooks);
    if (review.ai.status === "done" && !opts.force) return { review, done: Promise.resolve(review) };
    const done = runReviewAi(this.app, review.id, this.deps, { ...hooks, ...(opts.force ? { force: true } : {}), signal: this.abort.signal });
    this.running.add(done);
    void done.finally(() => this.running.delete(done)).catch(() => undefined);
    return { review, done };
  }

  dismiss(ref: string, itemId: string): ReviewView {
    return dismissReviewItem(this.app, ref, itemId, this.now);
  }

  restore(ref: string, itemId: string): ReviewView {
    return restoreReviewItem(this.app, ref, itemId);
  }
}
