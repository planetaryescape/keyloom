import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityChoices, SuggestionTestResults, WorkloadTests } from "../../src/web/review/WorkloadTests.tsx";
import { ReviewWorkloadSchema } from "../../src/layout/review-workload.ts";

const baseline = { id: "prose-prose", status: "verified" as const, requestedOutputs: 21, physicalKeydowns: 22, maxSimultaneousKeys: 2, layerEntries: 1, modifierEntries: 0, busyKeys: [] };
const candidate = { ...baseline, physicalKeydowns: 21, maxSimultaneousKeys: 1, layerEntries: 0 };

test("activity choices do not preselect a use case and remain native labeled checkboxes", () => {
  const html = renderToStaticMarkup(createElement(ActivityChoices, { value: [], onChange: () => {} }));
  expect(html.match(/type="checkbox"/g)).toHaveLength(6);
  expect(html).not.toContain("checked");
  expect(html).toContain("What will you use this board for?");
  for (const text of ["Writing", "TypeScript", "Python", "JSON", "Terminal", "Shortcuts"]) expect(html).toContain(text);
});

test("review evidence rejects an unknown task status", () => {
  expect(ReviewWorkloadSchema.safeParse({ status: "done", activities: ["prose"], reason: null, identity: null,
    baseline: [{ ...baseline, status: "verifed" }], comparisons: [] }).success).toBe(false);
});

test("no selection explains the opt-in, Docker cost and test limits", () => {
  const html = renderToStaticMarkup(createElement(WorkloadTests, { activities: [], evidence: undefined, busy: false, onRun: () => {} }));
  expect(html).toContain("No activities assumed");
  expect(html).toContain("Uses Docker");
  expect(html).toContain("Never types on or flashes");
  expect(html).toContain("not a whole-layout score");
  expect(html).toContain("disabled");
});

test("a selected profile awaiting its first review is not reported as unselected", () => {
  const html = renderToStaticMarkup(createElement(WorkloadTests, { activities: ["prose"], evidence: undefined, busy: false, onRun: () => {} }));
  expect(html).toContain("Selected activities will be tested");
  expect(html).not.toContain("No activities assumed");
});

test("orphaned pending/running evidence does not announce active testing", () => {
  for (const status of ["pending", "running"] as const) {
    const evidence = ReviewWorkloadSchema.parse({ status, activities: ["prose"], reason: null, identity: null, baseline: [], comparisons: [] });
    const stopped = renderToStaticMarkup(createElement(WorkloadTests, { activities: ["prose"], evidence, busy: false, onRun: () => {} }));
    expect(stopped).not.toContain("Testing this version");
    expect(stopped).toContain("not running");
    const active = renderToStaticMarkup(createElement(WorkloadTests, { activities: ["prose"], evidence, busy: true, onRun: () => {} }));
    expect(active).toContain("Testing this version");
  }
});

test("persisted profiles fold choices, show verified coverage and retain unavailable tasks", () => {
  const evidence = ReviewWorkloadSchema.parse({ status: "done", activities: ["prose", "shortcuts"], reason: "Some tasks are unverified.", identity: null,
    baseline: [baseline, { ...baseline, id: "shortcuts-navigation", status: "no-route-within-supported-subset", physicalKeydowns: null, maxSimultaneousKeys: null }], comparisons: [] });
  const html = renderToStaticMarkup(createElement(WorkloadTests, { activities: ["prose", "shortcuts"], evidence, busy: false, onRun: () => {} }));
  expect(html).toContain("1 of 2 tasks verified");
  expect(html).toContain("no route within supported subset");
  expect(html).toContain("Turn off tests");
  expect(html).toContain("<details");
});

test("suggestion results show baseline to candidate costs without making up missing numbers", () => {
  const result = { proposalId: "cs_test", patchHash: "hash", verdict: "verified-improvement" as const, reason: null, tasks: [candidate], deltas: [{ id: baseline.id, physicalKeydowns: -1, maxSimultaneousKeys: -1 }] };
  const html = renderToStaticMarkup(createElement(SuggestionTestResults, { baseline: [baseline], result }));
  expect(html).toContain("22 → 21 presses · peak 2 → 1 keys");
  const unknown = renderToStaticMarkup(createElement(SuggestionTestResults, { baseline: [baseline], result: { ...result, verdict: "inconclusive", tasks: [{ ...candidate, status: "output-mismatch", physicalKeydowns: null, maxSimultaneousKeys: null }] } }));
  expect(unknown).toContain("verified → output mismatch");
  expect(unknown).not.toContain("→ 0 presses");
});
