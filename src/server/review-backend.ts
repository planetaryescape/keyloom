import type { ReviewEvent, ReviewResponse } from "../api/review.ts";
import type { ReviewActivity } from "../api/review.ts";

// The server's board review interface (D-340). Like the other backends, the CLI injects the app-backed implementation.
export interface ReviewBackend {
  show(ref: string): Promise<ReviewResponse>;
  /** Returns head checks at once; the agent continues via `subscribe`. `activities` saves a profile ([] disables tests) and, like `force`, reruns a finished review. Omit it to keep the profile. */
  run(ref: string, opts: { force: boolean; activities?: ReviewActivity[] }): Promise<ReviewResponse>;
  dismiss(ref: string, itemId: string): Promise<ReviewResponse>;
  restore(ref: string, itemId: string): Promise<ReviewResponse>;
  subscribe(listener: (event: ReviewEvent) => void): () => void;
}

/** A failure the browser should see as-is. */
export class ReviewError extends Error {
  constructor(
    readonly status: 400 | 404,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ReviewError";
  }
}
