// The server's board review interface over the app's review engine (D-340). The server stays ignorant of storage and the model; this
// adapter is the one place that knows both.
import { NotFoundError, UsageError } from "../app/index.ts";
import type { ReviewEngine } from "../app/review-engine.ts";
import { ReviewError, type ReviewBackend } from "../server/review-backend.ts";

/** Turns the app's typed errors into the status and code the browser acts on; anything else stays a 500. */
async function translate<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NotFoundError) throw new ReviewError(404, "not_found", err.message);
    if (err instanceof UsageError) throw new ReviewError(400, "usage", err.message);
    throw err;
  }
}

export function appReviewBackend(engine: ReviewEngine): ReviewBackend {
  return {
    show: (ref) => translate(() => engine.show(ref)),
    run: (ref, opts) =>
      translate(() => {
        // Only the checks are waited for; the agent's part is announced on the events stream when it moves.
        engine.review(ref, "manual", opts);
        return engine.show(ref);
      }),
    dismiss: (ref, itemId) => translate(() => engine.dismiss(ref, itemId)),
    restore: (ref, itemId) => translate(() => engine.restore(ref, itemId)),
    subscribe: (listener) => engine.subscribe(listener),
  };
}
