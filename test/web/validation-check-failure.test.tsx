// R9-02: a change check that fails keeps its code, so the box picks its buttons with `wayOutFor`. An answer that fails the same way every
// time never shows Check again alone, an exception adds keyloom's log, and a layout deleted in another window says so.
import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Layout } from "../../src/layout/schema.ts";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { ApiError, UNREACHABLE } from "../../src/web/api.ts";
import { LAYOUT_GONE_HERE, OtherLayoutsContext } from "../../src/web/editor/LayoutGone.tsx";
import { Validation } from "../../src/web/editor/Validation.tsx";
import { checkFailed } from "../../src/web/editor/useCheck.ts";
import { LAYOUT_GONE } from "../../src/web/release/flash-words.ts";
import { INTERNAL_WORDS, NOT_FOUND_WORDS, UNREADABLE_WORDS } from "../../src/web/shell/unexpected.ts";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";

const layout: Layout = (await importOryxSource(FIXTURE_DIR, (await moonlander()).definition)).layout;
const render = (error: unknown) => renderToStaticMarkup(createElement(Validation, { token: "t", layout, idleNote: "", state: checkFailed(error), onRecheck: () => {} }));

test("an exception gets Check again and Restart keyloom", () => {
  const html = render(new ApiError(500, INTERNAL_WORDS, { code: "internal" }));
  expect(html).toContain(INTERNAL_WORDS.replace(/'/g, "&#x27;"));
  expect(html).toContain("Check again");
  expect(html).toContain("Restart keyloom");
});

test("an unreadable answer and keyloom's catch-all get Restart keyloom alone, never Check again", () => {
  for (const error of [new ApiError(400, UNREADABLE_WORDS, { code: "unreadable" }), new ApiError(404, NOT_FOUND_WORDS, { code: "not_found", generic: true })]) {
    const html = render(error);
    expect(html).toContain("Restart keyloom");
    expect(html).not.toContain("Check again");
  }
});

test("a layout deleted in another window says so with Restart keyloom, never the server's sentence or Check again", () => {
  const state = checkFailed(new ApiError(404, "no layout lay_1", { code: "not_found" }));
  expect(state.message).toBe(LAYOUT_GONE);
  const html = render(new ApiError(404, "no layout lay_1", { code: "not_found" }));
  expect(html).toContain("Restart keyloom");
  expect(html).not.toContain("Check again");
  expect(html).not.toContain("no layout lay_1");
});

test("a lost connection keeps Check again alone, because a second try can pass", () => {
  const html = render(new ApiError(0, UNREACHABLE));
  expect(html).toContain("Check again");
  expect(html).not.toContain("Restart keyloom");
});

test("a check against a moved head shows no button of its own: the page reads the newer head", () => {
  const state = checkFailed(new ApiError(409, "stale", { code: "stale_base" }));
  expect(state.stale).toBe(true);
  const html = render(new ApiError(409, "stale", { code: "stale_base" }));
  expect(html).not.toContain("Check again");
  expect(html).not.toContain("Restart keyloom");
});

test("on a layout page, a layout deleted elsewhere offers Show your other layouts first, then Restart keyloom (R10-09)", () => {
  const error = new ApiError(404, "no layout lay_1", { code: "not_found" });
  const html = renderToStaticMarkup(createElement(OtherLayoutsContext.Provider, { value: () => {} },
    createElement(Validation, { token: "t", layout, idleNote: "", state: checkFailed(error), onRecheck: () => {} })));
  expect(html).toContain(LAYOUT_GONE_HERE.replace(/'/g, "&#x27;"));
  expect(html).not.toContain("Restarting keyloom opens");
  expect(html.indexOf("Show your other layouts")).toBeGreaterThan(-1);
  expect(html.indexOf("Show your other layouts")).toBeLessThan(html.indexOf("Restart keyloom"));
  expect(html).toMatch(/button-primary"[^>]*>(<svg[^]*?<\/svg>)?Show your other layouts/);
});
