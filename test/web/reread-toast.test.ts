// R10-07: Show the new layout and Show the latest version read the layout again only where a second read can pass. An answer that fails
// the same way every time gets Restart keyloom, which opens the restart dialog, never a button that reads again for ever.
import { expect, test } from "bun:test";
import { ApiError, UNREACHABLE } from "../../src/web/api.ts";
import { LAYOUT_GONE_REREAD, rereadToast } from "../../src/web/editor/reread-toast.ts";
import type { UnexpectedDialog } from "../../src/web/shell/failed-toast.ts";
import { INTERNAL_WORDS, NOT_FOUND_WORDS, UNREADABLE_WORDS } from "../../src/web/shell/unexpected.ts";

function toast(error: unknown) {
  const opened: UnexpectedDialog[] = [];
  let reads = 0;
  const input = rereadToast({ message: "Applied. keyloom couldn't show the new layout yet.", lead: "Lead.", error, label: "Show the new layout", again: () => { reads++; }, open: (d) => void opened.push(d) });
  input.action?.run();
  return { input, opened, reads: () => reads };
}

test("a lost connection keeps the button that reads again", () => {
  const { input, opened, reads } = toast(new ApiError(0, UNREACHABLE, { code: "unreachable" }));
  expect(input.action?.label).toBe("Show the new layout");
  expect(input.detail).toBe(`Lead. ${UNREACHABLE}`);
  expect(reads()).toBe(1);
  expect(opened).toEqual([]);
});

test("an unreadable answer or keyloom's catch-all opens Restart keyloom, with no read again", () => {
  for (const error of [new ApiError(400, UNREADABLE_WORDS, { code: "unreadable" }), new ApiError(404, NOT_FOUND_WORDS, { code: "not_found", generic: true })]) {
    const { input, opened, reads } = toast(error);
    expect(input.action?.label).toBe("Restart keyloom");
    expect(reads()).toBe(0);
    expect(opened[0]?.retry).toBeUndefined();
    expect(opened[0]?.title).toBe("Applied. keyloom couldn't show the new layout yet.");
  }
});

test("an exception opens Restart keyloom, whose dialog can read again", () => {
  const { input, opened } = toast(new ApiError(500, INTERNAL_WORDS, { code: "internal" }));
  expect(input.action?.label).toBe("Restart keyloom");
  expect(opened[0]?.retry).toBeDefined();
});

test("a layout deleted elsewhere offers the page's other layouts, never a read that fails again (PR #313 review)", () => {
  let shown = 0;
  const opened: UnexpectedDialog[] = [];
  const error = new ApiError(404, "no layout lay_1", { code: "not_found" });
  const input = rereadToast({ message: "m", error, label: "Show the new layout", again: () => { throw new Error("must not read again"); }, open: (d) => void opened.push(d), showOthers: () => { shown++; } });
  expect(input.action?.label).toBe("Show your other layouts");
  expect(input.detail).toBe(LAYOUT_GONE_REREAD);
  input.action?.run();
  expect(shown).toBe(1);
  // Without a page to go back to, Restart keyloom.
  const alone = rereadToast({ message: "m", error, label: "Show the new layout", again: () => {}, open: (d) => void opened.push(d) });
  expect(alone.action?.label).toBe("Restart keyloom");
  alone.action?.run();
  expect(opened[0]?.retry).toBeUndefined();
});
