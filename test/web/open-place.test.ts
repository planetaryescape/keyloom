// R1-23: copy that names a place opens it. A link dispatches; the Viewer's subscription opens the place, and nothing else does.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { onOpenPlace, openPlace, type Place } from "../../src/web/shell/open-place.ts";

// bun's test runtime has no DOM; an EventTarget is all this module uses of window. Each test sets its own, whatever earlier files in
// this process left: a "window" property set to undefined once made a check at import skip the setup (release PR #294, run
// 43134459051). Whatever was there before is put back.
let before: PropertyDescriptor | undefined;
beforeEach(() => {
  before = Object.getOwnPropertyDescriptor(globalThis, "window");
  (globalThis as { window?: EventTarget }).window = new EventTarget();
});
afterEach(() => {
  if (before === undefined) delete (globalThis as { window?: EventTarget }).window;
  else Object.defineProperty(globalThis, "window", before);
});

describe("opening a place from copy", () => {
  test("a link reaches the subscriber with its place, until it unsubscribes", () => {
    const opened: Place[] = [];
    const off = onOpenPlace((place) => opened.push(place));
    openPlace("settings");
    openPlace("chat");
    off();
    openPlace("settings");
    expect(opened).toEqual(["settings", "chat"]);
  });

  test("an event with an unknown place is ignored", () => {
    const opened: Place[] = [];
    const off = onOpenPlace((place) => opened.push(place));
    window.dispatchEvent(new CustomEvent("keyloom:open-place", { detail: "history" }));
    off();
    expect(opened).toEqual([]);
  });
});
