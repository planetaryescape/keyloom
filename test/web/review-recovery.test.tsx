// #288 review: a refused look and an unread proposals list each offer the button that fixes them.
import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BoardReview } from "../../src/api/review.ts";
import { ReviewPanel } from "../../src/web/review/ReviewPanel.tsx";
import type { Review } from "../../src/web/review/useReview.ts";
import { tinyBoard, tinyLayout } from "../helpers/workload.ts";

function panel(ai: BoardReview["ai"], items: BoardReview["items"] = [], proposalsFailed = false) {
  const review: Review = {
    review: { id: "rvw", layoutId: "lay", revisionId: "rev", trigger: "manual", checkedAt: 0, checks: { status: "done", summary: { layers: 1, keys: 4, combos: 0 } }, ai, freshness: { current: true, reason: null }, fixed: [], items },
    stale: false, loaded: true, busy: false, refreshing: false, problem: null, activities: [], justFixed: [], clearJustFixed() {},
    run: async () => {}, dismiss: async () => {}, restore: async () => {}, reload: () => undefined,
  };
  return renderToStaticMarkup(createElement(ReviewPanel, {
    token: "synthetic", review, layout: tinyLayout(), board: tinyBoard(), rows: {}, boardName: "Synthetic", configName: "Synthetic config", proposals: proposalsFailed ? [] : null,
    pinnedId: null, onPin() {}, onApply: async () => {}, onShowLayer() {}, onPlanRepair() {}, onClose() {}, proposalsFailed, onReadProposals() {},
  }));
}

test("a refused account offers the setup and a Try again for after it is fixed at the provider", () => {
  const html = panel({ status: "unavailable", reason: "OpenRouter rejected the API key (401).", model: "anthropic/claude-opus-5.5", code: "auth" });
  expect(html).toContain("Set up a model");
  expect(html).toContain("Try again");
  expect(html).toContain("then try again");
});

test("no model set up offers only the setup: trying again can't help yet", () => {
  const html = panel({ status: "unavailable", reason: "No model provider is set up.", model: null, code: "missing_key" });
  expect(html).toContain("Set up a model");
  expect(html).not.toContain("Try again");
});

test("an unread proposals list says so with Try again, and a suggestion says its change wasn't read, not that it is invalid", () => {
  const suggestion: BoardReview["items"][number] = { id: "s", source: "agent", kind: "suggestion", severity: "info", code: "suggestion", title: "Synthetic suggestion", body: "b", keys: [], layers: [], proposalId: "proposal", fixes: [], dismissedAt: null };
  const html = panel({ status: "done", reason: null, model: "synthetic", code: null }, [suggestion], true);
  expect(html).toContain("couldn&#x27;t read this config&#x27;s proposals");
  expect(html).toContain("Try again");
  expect(html).toContain("change not read");
  expect(html).not.toContain("invalid for this version");
});
