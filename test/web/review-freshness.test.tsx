import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewMarker, ReviewPanel } from "../../src/web/review/ReviewPanel.tsx";
import type { Review } from "../../src/web/review/useReview.ts";
import { tinyBoard, tinyLayout } from "../helpers/workload.ts";
import { evaluate } from "../../src/validation/validate.ts";

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

function populatedReview(): Review {
  return {
    review: { id: "rvw", layoutId: "lay", revisionId: "rev", trigger: "connect", checkedAt: 0,
      checks: { status: "done", summary: { layers: 1, keys: 4, combos: 0 } }, ai: { status: "done", reason: null, model: null },
      freshness: { current: true, reason: null }, fixed: [], items: [
        { id: "finding", source: "check", kind: "hint", severity: "info", code: "keys_do_nothing", title: "Previous finding", body: "Old result", keys: [{ layerId: "layer-0", position: 0 }], layers: ["layer-0"], proposalId: null, fixes: [], dismissedAt: null },
        { id: "suggestion", source: "agent", kind: "suggestion", severity: "info", code: "suggestion", title: "Previous suggestion", body: "Old proposal", keys: [], layers: [], proposalId: "proposal", fixes: [], dismissedAt: null },
        { id: "hidden", source: "check", kind: "hint", severity: "info", code: "hidden", title: "Hidden finding", body: "Hidden", keys: [], layers: [], proposalId: null, fixes: [], dismissedAt: 1 },
      ] },
    stale: false, loaded: true, busy: false, problem: null, activities: [], justFixed: [], clearJustFixed() {},
    run: async () => {}, dismiss: async () => {}, restore: async () => {}, reload: () => undefined,
  };
}

function panel(review: Review) {
  return renderToStaticMarkup(createElement(ReviewPanel, {
    token: "synthetic", review, layout: tinyLayout(), rows: {}, boardName: "Synthetic", configName: "Synthetic config",
    proposals: [{ changeSetId: "proposal", proposalGroup: null, title: "Synthetic proposal", explanation: "Synthetic", status: "proposed", ops: [],
      validation: evaluate(tinyBoard(), tinyLayout(), []).result, tradeoffs: { gains: [], costs: [] }, decisionDraft: null }],
    pinnedId: null, onPin() {}, onApply: async () => {}, onShowLayer() {}, onFixIssues() {}, onClose() {},
  }));
}

for (const phase of ["pending", "running", "request", "initial"] as const) test(`${phase} review hides previous results and all result actions`, () => {
  const r = populatedReview();
  if (phase === "request") r.busy = true;
  else if (phase === "initial") r.loaded = false;
  else r.review!.ai.status = phase;
  const html = panel(r);
  expect(html).toContain("Looking over your Synthetic");
  expect(html).toContain('role="status"');
  expect(html).not.toContain("looked over");
  expect(html).not.toContain("Previous finding");
  expect(html).not.toContain("Previous suggestion");
  expect(html).not.toContain("No findings");
  expect(html.match(/<button\b/g)).toHaveLength(1); // Close stays available; no Show/Hide/Fix/Apply/test controls.
  const marker = renderToStaticMarkup(createElement(ReviewMarker, { review: r, open: true, onToggle() {} }));
  if (r.loaded) expect(marker).toContain("Looking over");
});

test("stale findings are read-only until replaced, and completed findings become interactive", () => {
  const r = populatedReview();
  expect(panel(r)).toContain("Previous finding");
  expect(panel(r)).toContain(">Apply</button>");
  expect(panel(r)).toContain(">Show it on the board</button>");
  expect(panel(r)).toMatch(/<button[^>]*class="sheet-action"[^>]*>Show the layer<\/button>/);
  r.stale = true;
  const html = panel(r);
  const controls = (html.match(/<button\b[^>]*>[^<]*<\/button>/g) ?? []).filter((button) => /Show the layer|>Hide<|Not this|Show hidden|>Apply<|Show it on the board/.test(button));
  expect(controls).toHaveLength(6);
  for (const button of controls) expect(button).toContain('disabled=""');
});

for (const status of ["done", "failed", "unavailable"] as const) test(`${status} review reveals source checks after loading ends`, () => {
  const r = populatedReview();
  r.review!.ai.status = status;
  const html = panel(r);
  expect(html).toContain("Previous finding");
  expect(html).not.toContain('aria-busy="true"');
});
