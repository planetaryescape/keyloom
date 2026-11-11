// How long a toast stays (R2-14): a toast with a button stays at least 12 s, and no toast leaves while the pointer is on it or focus is
// in it. Driven with a hand-wound clock, so nothing waits on real time.
import { describe, expect, test } from "bun:test";
import { ACTION_MIN_MS, RELEASE_MIN_MS, dismissTimer, toastLifetime } from "../../src/web/shell/Toasts.tsx";

/** A clock whose time moves only when `tick` says, running each timer that falls due. */
function clock() {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    set: (fn: () => void, ms: number) => {
      next += 1;
      timers.set(next, { at: now + ms, fn });
      return next;
    },
    clear: (id: unknown) => void timers.delete(id as number),
    tick(ms: number) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
  };
}

describe("toastLifetime", () => {
  test("news is 4 s and an error 8 s, but anything with a button stays at least 12 s", () => {
    expect(toastLifetime("success", false)).toBe(4000);
    expect(toastLifetime("error", false)).toBe(8000);
    expect(toastLifetime("error", true)).toBe(ACTION_MIN_MS);
    expect(toastLifetime("info", true)).toBe(12_000);
  });
});

describe("dismissTimer", () => {
  test("dismisses once its time is up", () => {
    const c = clock();
    let gone = 0;
    dismissTimer(12_000, () => gone++, c);
    c.tick(11_999);
    expect(gone).toBe(0);
    c.tick(1);
    expect(gone).toBe(1);
  });

  test("never dismisses while the pointer is on it or focus is in it, then runs on with the time it had left", () => {
    const c = clock();
    let gone = 0;
    const t = dismissTimer(12_000, () => gone++, c);
    c.tick(5000);
    t.hold("pointer");
    t.hold("focus");
    c.tick(60_000);
    expect(gone).toBe(0);
    // Both must let go: the pointer leaving while a button keeps focus still holds it.
    t.release("pointer");
    c.tick(60_000);
    expect(gone).toBe(0);
    t.release("focus");
    c.tick(6999);
    expect(gone).toBe(0);
    c.tick(1);
    expect(gone).toBe(1);
  });

  test("a toast let go near its end still stays long enough to read", () => {
    const c = clock();
    let gone = 0;
    const t = dismissTimer(4000, () => gone++, c);
    c.tick(3900);
    t.hold("pointer");
    t.release("pointer");
    c.tick(RELEASE_MIN_MS - 1);
    expect(gone).toBe(0);
    c.tick(1);
    expect(gone).toBe(1);
  });

  test("the same hold twice counts once, and stop cancels it", () => {
    const c = clock();
    let gone = 0;
    const t = dismissTimer(4000, () => gone++, c);
    t.hold("pointer");
    t.hold("pointer");
    t.release("pointer");
    c.tick(4000);
    expect(gone).toBe(1);
    const s = dismissTimer(4000, () => gone++, c);
    s.stop();
    c.tick(10_000);
    expect(gone).toBe(1);
  });
});
