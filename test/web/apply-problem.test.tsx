// R10-07: Settings, Combos, the tuner and Repeat keep a failed Apply's code. A failure no screen planned for gets Restart keyloom beside the
// sentence; one that fails the same way turns Apply off and makes Restart keyloom primary; a deleted layout offers the other layouts.
import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError, UNREACHABLE } from "../../src/web/api.ts";
import { ApplyProblem, applyProblem, applyStopped } from "../../src/web/editor/ApplyProblem.tsx";
import { LAYOUT_GONE_HERE, OtherLayoutsContext } from "../../src/web/editor/LayoutGone.tsx";
import { INTERNAL_WORDS, NOT_FOUND_WORDS, UNREADABLE_WORDS } from "../../src/web/shell/unexpected.ts";

const render = (error: unknown, home = false) => {
  const note = createElement(ApplyProblem, { token: "t", failure: applyProblem(error, "listed"), className: "apply-problem" });
  return renderToStaticMarkup(home ? createElement(OtherLayoutsContext.Provider, { value: () => {} }, note) : note);
};

test("a refusal the validator explained says only that it is listed", () => {
  const validation = { ok: false, errors: [], warnings: [] } as unknown as NonNullable<ApiError["validation"]>;
  const failure = applyProblem(new ApiError(422, "1 validation error: x", { code: "validation_failed", validation }), "listed");
  expect(failure).toEqual({ message: "listed" });
  expect(applyStopped(failure)).toBe(false);
});

test("an exception keeps Apply on as its Try again, with Restart keyloom and the log", () => {
  const error = new ApiError(500, INTERNAL_WORDS, { code: "internal" });
  expect(applyStopped(applyProblem(error, "listed"))).toBe(false);
  const html = render(error);
  expect(html).toContain("Restart keyloom");
  expect(html).not.toContain("Try again");
});

test("an unreadable answer or keyloom's catch-all turns Apply off, with Restart keyloom", () => {
  for (const error of [new ApiError(400, UNREADABLE_WORDS, { code: "unreadable" }), new ApiError(404, NOT_FOUND_WORDS, { code: "not_found", generic: true })]) {
    expect(applyStopped(applyProblem(error, "listed"))).toBe(true);
    expect(render(error)).toContain("Restart keyloom");
  }
});

test("a lost connection keeps Apply on and adds no button", () => {
  const error = new ApiError(0, UNREACHABLE);
  expect(applyStopped(applyProblem(error, "listed"))).toBe(false);
  expect(render(error)).not.toContain("Restart keyloom");
});

test("a layout deleted elsewhere turns Apply off and offers the other layouts on a layout page (R10-09)", () => {
  const error = new ApiError(404, "no layout lay_1", { code: "not_found" });
  expect(applyStopped(applyProblem(error, "listed"))).toBe(true);
  const html = render(error, true);
  expect(html).toContain(LAYOUT_GONE_HERE.replace(/'/g, "&#x27;"));
  expect(html).toContain("Show your other layouts");
  expect(html).not.toContain("no layout lay_1");
});
