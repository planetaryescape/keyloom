// The "doesn't match its board" page after the server refuses Go back (D-506): a stale page reloads, anything else drops the button.
import { describe, expect, test } from "bun:test";
import { goBackRefusal } from "../../src/web/shell/mismatch-words.ts";

describe("goBackRefusal", () => {
  test("a layout that changed since the page loaded is read again, which gives the button a current head to go back from", () => {
    expect(goBackRefusal("stale_base", "base revision rev_1 is not the head")).toEqual({ text: "This layout changed since the page loaded, so keyloom didn't go back.", next: "reload" });
  });

  test("a revision the server refuses for itself is not offered again: its reason stays and the button goes", () => {
    expect(goBackRefusal("validation_failed", "Layer 2 has no way in.")).toEqual({ text: "Layer 2 has no way in.", next: null });
    expect(goBackRefusal(undefined, "refused")).toEqual({ text: "refused", next: null });
  });
});
