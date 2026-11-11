// R1-23: copy that names a place opens it. A link dispatches; the Viewer's subscription opens the place, and nothing else does.
import { afterAll, describe, expect, test } from "bun:test";
import { onOpenPlace, openPlace, type Place } from "../../src/web/shell/open-place.ts";

const hadWindow = "window" in globalThis;
// bun's test runtime has no DOM; an EventTarget is all this module uses of window.
if (!hadWindow) (globalThis as { window?: EventTarget }).window = new EventTarget();
// Other test files share this process; leave no window behind for code that checks for one.
afterAll(() => {
  if (!hadWindow) delete (globalThis as { window?: EventTarget }).window;
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
