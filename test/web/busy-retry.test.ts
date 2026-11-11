// Sync now while keyloom is busy (R3-18): the page asks again by itself until the other work ends, says so once, and stops promising
// after its time limit.
import { describe, expect, test } from "bun:test";
import { ApiError } from "../../src/web/api.ts";
import { retryWhileBusy } from "../../src/web/sync/busy-retry.ts";
import { refusalNotice } from "../../src/web/sync/words.ts";

const busy = () => new ApiError(400, "another keyloom sync is running (syn_1, process 42); wait for it or use --wait", { code: "busy" });

describe("retryWhileBusy", () => {
  test("asks again until the request is no longer busy, and tells the page once", async () => {
    let calls = 0;
    let told = 0;
    const answer = await retryWhileBusy(async () => (++calls < 3 ? Promise.reject(busy()) : "synced"), { signal: new AbortController().signal, onBusy: () => void told++, wait: async () => {} });
    expect(answer).toBe("synced");
    expect(calls).toBe(3);
    expect(told).toBe(1);
  });

  test("past its time limit it throws busy_timed_out, so the page stops promising a sync", async () => {
    let clock = 0;
    const run = retryWhileBusy(async () => Promise.reject(busy()), { signal: new AbortController().signal, onBusy: () => {}, now: () => clock, wait: async (ms) => void (clock += ms), everyMs: 1000, forMs: 5000 });
    await expect(run).rejects.toMatchObject({ code: "busy_timed_out" });
  });

  test("any other refusal ends it at once", async () => {
    const refused = new ApiError(400, "no", { code: "not_connected" });
    await expect(retryWhileBusy(async () => Promise.reject(refused), { signal: new AbortController().signal, onBusy: () => {}, wait: async () => {} })).rejects.toBe(refused);
  });

  test("an aborted wait (a new Sync now, or the page closed) stops asking", async () => {
    const controller = new AbortController();
    let calls = 0;
    const answer = await retryWhileBusy(async () => (calls++, Promise.reject(busy())), { signal: controller.signal, onBusy: () => controller.abort(), wait: async () => {} });
    expect(answer).toBeUndefined();
    expect(calls).toBe(1);
  });

  test("a tab suspended past the time limit doesn't sync late: the limit is checked before each retry", async () => {
    let clock = 0;
    let calls = 0;
    // One wait that lasts an hour, as a suspended tab's timer would.
    const run = retryWhileBusy(async () => (calls++, Promise.reject(busy())), { signal: new AbortController().signal, onBusy: () => {}, now: () => clock, wait: async () => void (clock += 3_600_000), forMs: 5000 });
    await expect(run).rejects.toMatchObject({ code: "busy_timed_out" });
    expect(calls).toBe(1);
  });

  test("the request gets the signal, and an answer that arrives after an abort is dropped", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const answer = await retryWhileBusy(async (signal) => { seen = signal; controller.abort(); return "late"; }, { signal: controller.signal, onBusy: () => {}, wait: async () => {} });
    expect(seen).toBe(controller.signal);
    expect(answer).toBeUndefined();
  });

  test("the words never name CLI commands, and only the waiting Sync now promises a sync", () => {
    expect(refusalNotice("busy_waiting", busy().message).detail).toBe("keyloom syncs this when that finishes.");
    expect(refusalNotice("busy", busy().message).detail).toBe("Try again when it finishes.");
    expect(refusalNotice("busy_timed_out", busy().message).action?.label).toBe("Open keyboard status");
    expect(JSON.stringify(refusalNotice("busy_waiting", busy().message))).not.toContain("--wait");
  });
});
