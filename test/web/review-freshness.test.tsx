import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewPanel } from "../../src/web/review/ReviewPanel.tsx";
import { tinyLayout } from "../helpers/workload.ts";

test("an invalidated review offers one fresh-review action rather than pretending a model call failed", () => {
  const html = renderToStaticMarkup(createElement(ReviewPanel, {
    token: "synthetic", review: {
      review: { id: "rvw", layoutId: "lay", revisionId: "rev", trigger: "connect", checkedAt: 0,
        checks: { status: "done", summary: { layers: 1, keys: 4, combos: 0 } }, ai: { status: "failed", reason: "The keyboard reconnected.", model: null },
        freshness: { current: false, reason: "The keyboard reconnected. A fresh analysis is required." }, items: [], fixed: [] },
      stale: true, loaded: true, busy: false, problem: null, activities: [], justFixed: [], clearJustFixed() {}, run: async () => {}, dismiss: async () => {}, restore: async () => {}, reload: () => undefined,
    }, layout: tinyLayout(), rows: {}, boardName: "Synthetic", configName: "Synthetic config", proposals: [], pinnedId: null,
    onPin() {}, onApply: async () => {}, onShowLayer() {}, onFixIssues() {}, onClose() {},
  }));
  expect(html).toContain("Review out of date");
  expect(html).toContain("The keyboard reconnected. A fresh analysis is required.");
  expect(html.match(/Run a fresh review/g)).toHaveLength(1);
  expect(html).not.toContain("Try again");
  expect(html).not.toContain("br-nothing");
});
