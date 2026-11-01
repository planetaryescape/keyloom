import type { ViewResult } from "../agent/open-view.ts";

/** One in-flight action, not a durable executor. A restart cannot reconstruct this waiter. */
export function openViewWaiter(signal: AbortSignal, timeoutMs = 5_000) {
  let closed = false;
  let settle: ((result: ViewResult) => void) | undefined;
  return {
    wait(publish: () => void): Promise<ViewResult> {
      if (closed || signal.aborted) return Promise.resolve({ version: 1, status: "unavailable", reason: "cancelled" });
      if (settle) return Promise.resolve({ version: 1, status: "unavailable", reason: "busy" });
      return new Promise((resolve, reject) => {
        const abort = () => finish({ version: 1, status: "unavailable", reason: "cancelled" });
        const timer = setTimeout(() => finish({ version: 1, status: "unavailable", reason: "timeout" }), timeoutMs);
        const finish = (result: ViewResult) => {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          settle = undefined;
          resolve(result);
        };
        settle = finish;
        signal.addEventListener("abort", abort, { once: true });
        try { publish(); } catch (error) {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          settle = undefined;
          reject(error);
        }
      });
    },
    ack(result: ViewResult): boolean {
      if (!settle || closed || signal.aborted) return false;
      settle(result);
      return true;
    },
    close() { closed = true; settle?.({ version: 1, status: "unavailable", reason: "cancelled" }); },
  };
}
