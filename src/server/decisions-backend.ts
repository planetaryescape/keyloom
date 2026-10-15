import type { DecisionCard, DecisionPatch, OutcomeAnswer, OutcomeQuestionsResponse } from "../api/http.ts";

// The server's decisions interface (rung 6). Like ChatBackend, the CLI injects the app-backed
// implementation, so the server knows nothing about the database.
export interface DecisionsBackend {
  /** The layout's decisions, newest first, without the retired ones; null when there is no such layout. */
  list(ref: string): Promise<DecisionCard[] | null>;
  update(id: string, patch: DecisionPatch): Promise<DecisionCard>;
  /** Retires a decision; false when there is none. */
  retire(id: string): Promise<boolean>;
  questions(ref: string): Promise<OutcomeQuestionsResponse["questions"] | null>;
  answer(id: string, answer: OutcomeAnswer): Promise<DecisionCard>;
}

/** A failure the browser should see as-is. */
export class DecisionError extends Error {
  constructor(
    readonly status: 400 | 404,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DecisionError";
  }
}
