// How long a toast stays (R2-14): a toast with a button stays at least 12 s, and no toast leaves while the pointer is on it or focus is
// in it. Driven with a hand-wound clock, so nothing waits on real time.
import { describe, expect, test } from "bun:test";
import { ACTION_MIN_MS, RELEASE_MIN_MS, type ToastInput, addToast, dismissTimer, focusLeftToast, toastLifetime } from "../../src/web/shell/Toasts.tsx";

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
    clear: (id: number) => void timers.delete(id),
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

describe("addToast", () => {
  const plain = (message: string): ToastInput => ({ kind: "info", message });
  const withAction = (message: string): ToastInput => ({ kind: "error", message, action: { label: "Restore", run: () => {} } });
  const names = (all: ToastInput[]) => all.map((t) => t.message);

  test("a full stack drops its oldest plain toast, so one with a button keeps its time (review of #279)", () => {
    expect(names(addToast([withAction("a"), plain("b"), plain("c")], plain("d"), 3))).toEqual(["a", "c", "d"]);
    expect(names(addToast([plain("a"), withAction("b"), plain("c")], withAction("d"), 3))).toEqual(["b", "c", "d"]);
  });

  test("with room it only adds, and a stack of buttons drops its oldest", () => {
    expect(names(addToast([plain("a")], plain("b"), 3))).toEqual(["a", "b"]);
    expect(names(addToast([withAction("a"), withAction("b"), withAction("c")], plain("d"), 3))).toEqual(["b", "c", "d"]);
  });
});

describe("focus and visibility", () => {
  test("focus moving to another app keeps the hold; moving elsewhere in keyloom lets it go", () => {
    expect(focusLeftToast(false, false)).toBe(false);
    expect(focusLeftToast(true, true)).toBe(false);
    expect(focusLeftToast(false, true)).toBe(true);
  });

  test("a hidden page holds the countdown like the pointer does, then runs on with the time left", () => {
    const c = clock();
    let gone = 0;
    const t = dismissTimer(12_000, () => gone++, c);
    c.tick(3000);
    t.hold("hidden");
    c.tick(600_000);
    expect(gone).toBe(0);
    t.release("hidden");
    c.tick(8999);
    expect(gone).toBe(0);
    c.tick(1);
    expect(gone).toBe(1);
  });
});
