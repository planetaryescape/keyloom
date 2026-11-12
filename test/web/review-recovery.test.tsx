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
    stale: false, loaded: true, busy: false, refreshing: false, problem: null, readFailed: false, problemAction: null, stopping: false, stop: async () => {}, activities: [], justFixed: [], clearJustFixed() {},
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

// R5-03, R5-10, R5-17: every failed review request shows its words with the button that moves on, before a first review too.
function shown(over: Partial<Review>) {
  const review: Review = {
    review: null, stale: false, loaded: true, busy: false, refreshing: false, problem: null, readFailed: false, problemAction: null, stopping: false, stop: async () => {},
    activities: [], justFixed: [], clearJustFixed() {}, run: async () => {}, dismiss: async () => {}, restore: async () => {}, reload: () => undefined, ...over,
  };
  return renderToStaticMarkup(createElement(ReviewPanel, {
    token: "synthetic", review, layout: tinyLayout(), board: tinyBoard(), rows: {}, boardName: "Synthetic", configName: "Synthetic config", proposals: null,
    pinnedId: null, onPin() {}, onApply: async () => {}, onShowLayer() {}, onPlanRepair() {}, onClose() {},
  }));
}
const reviewed = (ai: BoardReview["ai"], workload?: BoardReview["workload"]): BoardReview => ({
  id: "rvw", layoutId: "lay", revisionId: "rev", trigger: "manual", checkedAt: 0, checks: { status: "done", summary: { layers: 1, keys: 4, combos: 0 } }, ai,
  freshness: { current: true, reason: null }, fixed: [], items: [], ...(workload === undefined ? {} : { workload }),
});

test("Look it over now that failed before the first review says so with Try again (R5-03)", () => {
  const html = shown({ problem: "keyloom couldn't start the review. The server didn't answer.", problemAction: { label: "Try again", run() {} } });
  expect(html).toContain("Look it over now");
  expect(html).toContain("couldn&#x27;t start the review");
  expect(html).toContain(">Try again</button>");
});

test("a refused action after a review has loaded offers to read the review again (R5-10)", () => {
  const html = shown({ review: reviewed({ status: "done", reason: null, model: "synthetic", code: null }), problem: "keyloom couldn't hide that. no item.", problemAction: { label: "Read the review again", run() {} } });
  expect(html).toContain("couldn&#x27;t hide that");
  expect(html).toContain(">Read the review again</button>");
});

test("running activity tests offer Stop testing, and every other running look offers Stop the review (R5-17, R6-12)", () => {
  const workload = { status: "running" as const, activities: ["prose" as const], reason: null, identity: null, baseline: [], comparisons: [] };
  const running = { status: "running" as const, reason: null, model: null, code: null };
  expect(shown({ review: reviewed(running, workload) })).toContain("Stop testing");
  expect(shown({ review: reviewed(running, { ...workload, status: "pending" }) })).toContain("Stop testing");
  // A look with no tests, or tests that finished or couldn't run, is the model's part: Stop ends that.
  for (const tests of [undefined, { ...workload, status: "done" as const }, { ...workload, status: "unavailable" as const }]) {
    const html = shown({ review: reviewed(running, tests) });
    expect(html).toContain("Stop the review");
    expect(html).not.toContain("Stop testing");
  }
  expect(shown({ review: reviewed({ status: "running", reason: null, model: null, code: null }, workload), stopping: true })).toContain("Stopping");
});

test("a failed Stop is said beside the running look, not as an unreadable review", () => {
  const workload = { status: "running" as const, activities: ["prose" as const], reason: null, identity: null, baseline: [], comparisons: [] };
  const html = shown({ review: reviewed({ status: "running", reason: null, model: null, code: null }, workload), problem: "keyloom couldn't stop the review. The server didn't answer.", problemAction: { label: "Try again", run() {} } });
  expect(html).toContain("couldn&#x27;t stop the review");
  expect(html).not.toContain("review unavailable");
});

test("a used-up Codex plan shows its reset time and offers another model with Try again, not just Try again (R6-01)", () => {
  const html = panel({ status: "unavailable", reason: "Your ChatGPT plan has used up its Codex allowance until 3:45 PM.", model: "gpt-5.5", code: "usage_limit" });
  expect(html).toContain("until 3:45 PM.");
  // The provider status isn't read yet when the page first draws, so no ready provider is known: the setup for another is offered.
  expect(html).toContain("Set up another model");
  expect(html).toContain("Try again");
  expect(html).not.toContain("keyloom&#x27;s own look didn&#x27;t finish");
  // The reason shows in place, so there is no Details to open.
  expect(html).not.toContain(">Details<");
});
