// Whether a Codex question still holds the turn. keyloom's handler runs before Codex reports the call, and Codex can still report that
// call as failed. The MCP request carries no Codex item id, so a report cannot be matched to the call that paused the turn. Only the
// paused call can be confirmed, because every later call is refused. Failures are counted to tell when the paused call is among them.

// Codex writes its report before it sends the next call, but keyloom reads the two on separate connections. If the report has not
// arrived by then, the question stands.
const VERDICT_GRACE_MS = 1_000;

export type QuestionGate = {
  isPaused(): boolean;
  /** Codex started a question call. */
  started(id: string): void;
  /** A question call reached keyloom, whether or not it will run. */
  arrived(): void;
  /** The question's handler succeeded. */
  pause(): void;
  /** Codex reported a question call. */
  completed(id: string, confirmed: boolean): void;
  /** Waits briefly for Codex's report on the paused question. `asking` says the waiting call is itself a question. */
  verdict(asking: boolean): Promise<void>;
};

export function questionGate(graceMs = VERDICT_GRACE_MS): QuestionGate {
  let paused = false;
  let confirmed = false;
  let arrivals = 0;
  let failures = 0;
  // The paused call can be among the failures only after every question up to it has failed. Reports can arrive out of order.
  let failuresToRelease = 0;
  let waitingQuestions = 0;
  let wake: (() => void) | null = null;
  const unreported = new Set<string>();

  const settle = () => {
    if (paused && !confirmed && failures >= failuresToRelease && unreported.size <= waitingQuestions) paused = false;
    if (!paused || confirmed) wake?.();
  };

  return {
    isPaused: () => paused,
    started: (id) => void unreported.add(id),
    arrived: () => void arrivals++,
    pause() {
      paused = true;
      failuresToRelease = arrivals;
    },
    completed(id, wasConfirmed) {
      unreported.delete(id);
      if (wasConfirmed) {
        paused = true;
        confirmed = true;
      } else {
        failures++;
      }
      settle();
    },
    async verdict(asking) {
      if (!paused || confirmed) return;
      waitingQuestions = asking ? 1 : 0;
      settle();
      if (paused && !confirmed) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => wake?.(), graceMs);
          wake = () => {
            clearTimeout(timer);
            wake = null;
            resolve();
          };
        });
      }
      waitingQuestions = 0;
    },
  };
}
