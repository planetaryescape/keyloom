// Sync now while keyloom is already building or flashing (R3-18). The engine refuses with `busy`, and a sync started after that work ends
// can succeed, so the page asks again by itself instead of telling the person to come back later.
import { ApiError } from "../api.ts";

/** How often the page asks again, and for how long: a ZMK build in a cold Docker can take ten minutes, and a flash a few more. */
export const BUSY_RETRY_EVERY_MS = 3000;
export const BUSY_RETRY_FOR_MS = 15 * 60_000;

export type BusyRetryOptions = {
  /** Called once, on the first busy answer, so the page can say it will sync when the other work ends. */
  onBusy: (error: ApiError) => void;
  signal: AbortSignal;
  everyMs?: number;
  forMs?: number;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
};

/**
 * Runs `request` until it answers anything but `busy`. Past the time limit the last refusal is thrown with the code `busy_timed_out`, so
 * the page stops promising a sync; the limit is checked before every retry, so a tab the browser suspended past it never syncs late. An
 * aborted signal (the page went away, or another Sync now replaced this one) resolves undefined, and an answer that arrives after the
 * abort is dropped. `request` gets the signal, so an aborted one stops the request itself.
 */
export async function retryWhileBusy<T>(request: (signal: AbortSignal) => Promise<T>, opts: BusyRetryOptions): Promise<T | undefined> {
  const now = opts.now ?? Date.now;
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const until = now() + (opts.forMs ?? BUSY_RETRY_FOR_MS);
  let last: ApiError | undefined;
  for (;;) {
    if (opts.signal.aborted) return undefined;
    if (last !== undefined && now() >= until) throw new ApiError(last.status, last.message, { code: "busy_timed_out" });
    try {
      const answer = await request(opts.signal);
      return opts.signal.aborted ? undefined : answer;
    } catch (error) {
      if (opts.signal.aborted) return undefined;
      if (!(error instanceof ApiError) || error.code !== "busy") throw error;
      if (last === undefined) opts.onBusy(error);
      last = error;
    }
    await wait(opts.everyMs ?? BUSY_RETRY_EVERY_MS);
  }
}
