// A comparison that failed to load says why and offers Try again, which compares again (R1-21). It keeps the failure's code, so an answer
// that fails the same way every time offers Restart keyloom, and a version that is gone goes back to History (R9-05).
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError } from "../../src/web/api.ts";
import { type Comparing, VERSION_GONE, VersionCompare, compareFailure } from "../../src/web/history/VersionCompare.tsx";
import { INTERNAL_WORDS, NOT_FOUND_WORDS, type PageFailure } from "../../src/web/shell/unexpected.ts";

const milestone = { version: { id: "ver_1", revisionId: "rev_1", name: "Before", putOnAt: 1, endedAt: 2, current: false, summary: "s", createdAt: 1 }, revisions: [] };
const render = (failure: PageFailure) => renderToStaticMarkup(
  <VersionCompare
    token="t"
    comparing={{ milestone, status: "error", ...failure } satisfies Comparing}
    layout={{ layers: [], macros: [], tapDances: [], passthrough: null } as never}
    boardName="Glove80" layerId="base" layerName={(id) => id}
    onBack={() => {}} onClose={() => {}} onShowLayer={() => {}} onGoBack={() => {}} onPutOn={() => {}} onNewConfig={() => {}} onRetry={() => {}}
    blockedReason={null}
  />,
);

test("a failed comparison shows its reason with Try again", () => {
  const html = render({ message: "keyloom stopped answering." });
  expect(html).toContain("keyloom stopped answering.");
  expect(html).toContain("Try again");
  expect(html).not.toContain("Restart keyloom");
});

test("an exception gets Try again and Restart keyloom; keyloom's catch-all gets Restart keyloom alone", () => {
  const internal = render({ message: INTERNAL_WORDS, code: "internal" });
  expect(internal).toContain("Try again");
  expect(internal).toContain("Restart keyloom");
  const generic = render({ message: NOT_FOUND_WORDS, code: "not_found", generic: true });
  expect(generic).toContain("Restart keyloom");
  expect(generic).not.toContain("Try again");
});

test("a version that is gone says so and goes back to History, never Try again", () => {
  const failure = compareFailure(new ApiError(404, "config main has no revision \"rev_1\"", { code: "not_found" }));
  expect(failure.message).toBe(VERSION_GONE);
  const html = render(failure);
  expect(html).toContain("Back to History");
  expect(html).not.toContain("Try again");
  // keyloom's catch-all keeps its own words.
  expect(compareFailure(new ApiError(404, NOT_FOUND_WORDS, { code: "not_found", generic: true })).message).toBe(NOT_FOUND_WORDS);
});

test("a version that is gone drops the header's promise and the footer's ways forward (R10-09)", () => {
  const html = render(compareFailure(new ApiError(404, "config main has no revision \"rev_1\"", { code: "not_found" })));
  expect(html).not.toContain("Going back to it changes");
  expect(html).not.toContain("Go back to this");
  expect(html).not.toContain("New config from here");
  // A failure that isn't a missing version keeps them.
  const other = render({ message: INTERNAL_WORDS, code: "internal" });
  expect(other).toContain("Going back to it changes");
  expect(other).toContain("Go back to this");
});
