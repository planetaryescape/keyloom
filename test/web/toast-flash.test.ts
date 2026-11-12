// A toast left for the next page (D-316): shown once there, and the page that raised it shows it itself when storage is missing.
import { afterEach, describe, expect, test } from "bun:test";
import { leaveToast, takeToast } from "../../src/web/shell/toast-flash.ts";

// Put window back as it was. Assigning undefined would leave a "window" property behind, and a later file that checks
// `"window" in globalThis` would then skip setting its own (release PR #294's CI failure).
const original = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (original === undefined) delete (globalThis as { window?: unknown }).window;
  else Object.defineProperty(globalThis, "window", original);
});
function withStorage() {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
  };
}

describe("toast flash", () => {
  test("a toast left is taken once", () => {
    withStorage();
    expect(leaveToast({ kind: "info", message: "Archived Steno", detail: "It's under Archived" })).toBe(true);
    expect(takeToast()).toEqual({ kind: "info", message: "Archived Steno", detail: "It's under Archived" });
    expect(takeToast()).toBeNull();
  });

  test("without storage the caller is told to show it now, and nothing is taken", () => {
    (globalThis as { window?: unknown }).window = { get sessionStorage(): never { throw new Error("blocked"); } };
    expect(leaveToast({ kind: "info", message: "Made Colemak" })).toBe(false);
    expect(takeToast()).toBeNull();
  });
});
