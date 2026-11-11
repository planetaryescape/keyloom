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
 * the page stops promising a sync. An aborted signal (the page went away, or another Sync now replaced this one) resolves undefined.
 */
export async function retryWhileBusy<T>(request: () => Promise<T>, opts: BusyRetryOptions): Promise<T | undefined> {
  const now = opts.now ?? Date.now;
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const until = now() + (opts.forMs ?? BUSY_RETRY_FOR_MS);
  let told = false;
  for (;;) {
    if (opts.signal.aborted) return undefined;
    try {
      return await request();
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== "busy") throw error;
      if (now() >= until) throw new ApiError(error.status, error.message, { code: "busy_timed_out" });
      if (!told) opts.onBusy(error);
      told = true;
    }
    await wait(opts.everyMs ?? BUSY_RETRY_EVERY_MS);
  }
}
