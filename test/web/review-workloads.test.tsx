import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityChoices, SuggestionTestResults, NeedsDockerView, TESTS_NEED_DOCKER, WorkloadTests, testsNeedDocker } from "../../src/web/review/WorkloadTests.tsx";
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
  const html = renderToStaticMarkup(createElement(WorkloadTests, { token: "t", firmware: "zmk" as const, activities: [], evidence: undefined, busy: false, onRun: () => {} }));
  expect(html).toContain("No activities assumed");
  expect(html).toContain("Uses Docker");
  expect(html).toContain("Never types on or flashes");
  expect(html).toContain("not a whole-layout score");
  expect(html).toContain("disabled");
});

test("a selected profile awaiting its first review is not reported as unselected", () => {
  const html = renderToStaticMarkup(createElement(WorkloadTests, { token: "t", firmware: "zmk" as const, activities: ["prose"], evidence: undefined, busy: false, onRun: () => {} }));
  expect(html).toContain("Selected activities will be tested");
  expect(html).not.toContain("No activities assumed");
});

test("orphaned pending/running evidence does not announce active testing", () => {
  for (const status of ["pending", "running"] as const) {
    const evidence = ReviewWorkloadSchema.parse({ status, activities: ["prose"], reason: null, identity: null, baseline: [], comparisons: [] });
    const stopped = renderToStaticMarkup(createElement(WorkloadTests, { token: "t", firmware: "zmk" as const, activities: ["prose"], evidence, busy: false, onRun: () => {} }));
    expect(stopped).not.toContain("Testing this version");
    expect(stopped).toContain("not running");
    const active = renderToStaticMarkup(createElement(WorkloadTests, { token: "t", firmware: "zmk" as const, activities: ["prose"], evidence, busy: true, onRun: () => {} }));
    expect(active).toContain("Testing this version");
  }
});

test("persisted profiles fold choices, show verified coverage and retain unavailable tasks", () => {
  const evidence = ReviewWorkloadSchema.parse({ status: "done", activities: ["prose", "shortcuts"], reason: "Some tasks are unverified.", identity: null,
    baseline: [baseline, { ...baseline, id: "shortcuts-navigation", status: "no-route-within-supported-subset", physicalKeydowns: null, maxSimultaneousKeys: null }], comparisons: [] });
  const html = renderToStaticMarkup(createElement(WorkloadTests, { token: "t", firmware: "zmk" as const, activities: ["prose", "shortcuts"], evidence, busy: false, onRun: () => {} }));
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

test("a kanata board has no activity tests to offer (R1-13)", () => {
  const html = renderToStaticMarkup(createElement(WorkloadTests, { token: "t", firmware: "kanata" as const, activities: [], evidence: undefined, busy: false, onRun: () => {} }));
  expect(html).toBe("");
});

test("tests that stopped for Docker show the Docker callout from the code, not the sentence (R1-12)", () => {
  const evidence = ReviewWorkloadSchema.parse({ status: "unavailable", activities: ["prose"], reason: "Workload tests need Docker: Docker is not on this computer.", reasonCode: "docker", identity: null, baseline: [], comparisons: [] });
  expect(testsNeedDocker(evidence)).toBe(true);
  // The same sentence without the code is shown as it is: the page never parses it.
  expect(testsNeedDocker({ ...evidence, reasonCode: undefined })).toBe(false);
  expect(testsNeedDocker({ ...evidence, status: "failed" })).toBe(false);
  const html = renderToStaticMarkup(createElement(WorkloadTests, { token: "t", firmware: "zmk" as const, activities: ["prose"], evidence, busy: false, onRun: () => {} }));
  expect(html).toContain("Activity tests run in Docker");
  expect(html).not.toContain("Workload tests need Docker:");
  // Rows stored before the code existed still read.
  expect(ReviewWorkloadSchema.safeParse({ status: "unavailable", activities: ["prose"], reason: "x", identity: null, baseline: [], comparisons: [] }).success).toBe(true);
});

test("a readiness request that failed still offers Check again, and asks again by itself (#277 review)", () => {
  const noop = () => {};
  const docker = { readiness: null, unanswered: true, starting: false, problem: null, lastAction: null, start: noop, restart: noop, refresh: noop };
  const install = { state: null, problem: null, start: noop, cancel: noop };
  const html = renderToStaticMarkup(createElement(NeedsDockerView, { words: TESTS_NEED_DOCKER, docker, install, busy: false, onRetry: noop }));
  expect(html).toContain("couldn&#x27;t ask whether Docker is ready");
  expect(html).toContain("Check again");
  // While the first request is still out, there is nothing to say yet.
  const asking = renderToStaticMarkup(createElement(NeedsDockerView, { words: TESTS_NEED_DOCKER, docker: { ...docker, unanswered: false }, install, busy: false, onRetry: noop }));
  expect(asking).not.toContain("Check again");
});

test("Docker installed from the activity tests says it is ready once, with Test again (R3-14)", () => {
  const noop = () => {};
  const docker = { readiness: { ok: true as const, version: "29.0", engine: "Colima", autoStart: true }, unanswered: false, starting: false, problem: null, lastAction: null, start: noop, restart: noop, refresh: noop };
  const install = { state: { tool: "docker" as const, status: "succeeded" as const, phase: null, logTail: [], error: null, errorCode: null }, problem: null, start: noop, cancel: noop };
  const html = renderToStaticMarkup(createElement(NeedsDockerView, { words: TESTS_NEED_DOCKER, docker, install, busy: false, onRetry: noop }));
  expect(html).toContain("Docker is installed and running. Test again to see the results.");
  expect(html).not.toContain("Docker is ready now.");
  expect(html).not.toContain("You can build now.");
  expect(html).toContain("Test again");
  // Docker that came up some other way still gets its one line.
  const other = renderToStaticMarkup(createElement(NeedsDockerView, { words: TESTS_NEED_DOCKER, docker, install: { ...install, state: null }, busy: false, onRetry: noop }));
  expect(other.match(/Docker is ready now\./g)).toHaveLength(1);
});

test("Test and review says what it waits for while no activity is chosen (R6-24)", () => {
  const html = renderToStaticMarkup(createElement(WorkloadTests, { token: "t", firmware: "zmk" as const, activities: [], evidence: undefined, busy: false, onRun: () => {} }));
  expect(html).toContain("Choose at least one activity to test.");
  expect(html).toContain('aria-describedby="br-activities-why"');
  const chosen = renderToStaticMarkup(createElement(WorkloadTests, { token: "t", firmware: "zmk" as const, activities: ["prose"], evidence: undefined, busy: false, onRun: () => {} }));
  expect(chosen).not.toContain("Choose at least one activity");
});
