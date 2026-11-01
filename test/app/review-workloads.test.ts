import { expect, spyOn, test } from "bun:test";
import { createReview, runReviewAi, showReview } from "../../src/app/review.ts";
import { getLayout } from "../../src/app/layouts.ts";
import { applyChange, applyOps } from "../../src/app/changes.ts";
import { putConfig } from "../../src/app/keyboard-put.ts";
import { saveReviewActivities, selectedReviewSuite } from "../../src/app/review-workloads.ts";
import { recordPriority } from "../../src/app/decisions.ts";
import { ReviewEngine } from "../../src/app/review-engine.ts";
import { claimAi } from "../../src/persistence/reviews.ts";
import type { WorkloadDeps } from "../../src/app/workload.ts";
import { findChangeSet } from "../../src/persistence/change-sets.ts";
import { reviewActivities } from "../../src/persistence/review-workloads.ts";
import { finished, noModel, savedId, scriptedModel, submit } from "../helpers/review-world.ts";
import { draft } from "../helpers/ops.ts";
import { key, none, replayResult, stroke, tinyLayout, workloadApp } from "../helpers/workload.ts";

// Original prose fixture: E lives on a momentary layer; position 11 is empty and can hold a duplicate E without displacing anything.
function world() {
  const base = ["W", "S", "A", "M", "L", "T", "R", "DOT", "ENTER", "SPACE"].map(key);
  base.push({ kind: "layer", action: "momentary", layerId: "symbols" }, none);
  return workloadApp(tinyLayout(base, [key("E"), ...Array.from({ length: 11 }, () => ({ kind: "transparent" as const }))]));
}
const expectedProse = ["W", "E", "SPACE", "S", "E", "E", "SPACE", "A", "SPACE", "S", "M", "A", "L", "L", "SPACE", "T", "R", "E", "E", "DOT", "ENTER"];
const reports = () => replayResult(expectedProse.flatMap((code, i) => stroke(i * 20, code)));
const proposeE = {
  blocks: [{ tool: "propose_changes", input: {
    title: "E on the spare key", ops: [{ op: "setBinding", at: { layerId: "base", position: 11 }, binding: key("E") }],
    explanation: "Keep E on the layer and add a direct route.", tradeoffs: { gains: ["direct E"], costs: [] }, decisionDraft: draft(),
  } }],
};
const model = () => scriptedModel([proposeE, (seen) => submit([{
  kind: "suggestion", code: "direct-letter", title: "Guaranteed faster", body: "Proven 50% faster and more comfortable.",
  keys: [{ layerId: "base", position: 11 }], proposalId: savedId(seen.toolResults),
}]), finished]);

test("no activity selection performs no replay and makes no assumed usage profile", async () => {
  const w = world();
  try {
    const review = createReview(w.app, w.layoutId, "import").review;
    let calls = 0;
    const m = scriptedModel([submit([]), finished]);
    const done = await runReviewAi(w.app, review.id, { ...m.deps, workload: { replay: async () => { calls++; return reports(); } } });
    expect(calls).toBe(0);
    expect(done.workload).toBeUndefined();
    expect(JSON.stringify(m.requests[0]?.body)).toContain("No activities selected");
  } finally { w.app.db.close(); }
});

test("selected activities measure before the model and independently test its proposal once, without applying", async () => {
  const w = world();
  try {
    const before = getLayout(w.app, w.layoutId);
    saveReviewActivities(w.app, w.layoutId, ["prose"]);
    const { review } = createReview(w.app, w.layoutId, "import");
    expect(review.workload?.status).toBe("pending");
    const keydowns: number[] = [];
    const deps: WorkloadDeps = { replay: async (_app, _view, events) => {
      keydowns.push(events.filter((e) => e.action === "press").length);
      return reports();
    } };
    const m = model();
    const done = await runReviewAi(w.app, review.id, { ...m.deps, workload: deps });
    expect(done.ai.status).toBe("done");
    expect(keydowns).toEqual([22, 21]); // transparent fallback allows one sustained layer hold; baseline is not replayed again
    expect(done.workload).toMatchObject({ status: "done", activities: ["prose"], baseline: [{ status: "verified", physicalKeydowns: 22, maxSimultaneousKeys: 2 }], comparisons: [{ verdict: "verified-improvement", tasks: [{ physicalKeydowns: 21, maxSimultaneousKeys: 1 }], deltas: [{ physicalKeydowns: -1, maxSimultaneousKeys: -1 }] }] });
    const item = done.items.find((i) => i.kind === "suggestion")!;
    expect(item.body).toContain("no tested task costs more");
    expect(item.body).not.toContain("50%");
    expect(item.title).not.toContain("Guaranteed");
    expect(findChangeSet(w.app.db, item.proposalId!)?.status).toBe("proposed");
    expect(getLayout(w.app, w.layoutId)).toEqual(before);
    expect(showReview(w.app, w.layoutId).review?.workload).toEqual(done.workload);
    const request = JSON.stringify(m.requests[0]?.body.messages);
    expect(request).toContain("prose-prose: verified; physical keydowns 22");
    expect(request).not.toContain("we see a small tree");
    expect(request).not.toContain('"reports"');
    expect(request).not.toContain('"trace"');
  } finally { w.app.db.close(); }
});

test("an unverified selected task blocks an improvement and stays visible in coverage", async () => {
  const w = world();
  try {
    saveReviewActivities(w.app, w.layoutId, ["prose", "json"]);
    const { review } = createReview(w.app, w.layoutId, "connect");
    const m = model();
    const done = await runReviewAi(w.app, review.id, { ...m.deps, workload: { replay: async () => reports() } });
    expect(done.workload?.comparisons[0]?.verdict).toBe("inconclusive");
    expect(done.workload?.baseline.find((t) => t.id === "json-json")).toMatchObject({ status: "no-route-within-supported-subset", physicalKeydowns: null });
    expect(done.items.find((i) => i.kind === "suggestion")?.body).toContain("Not enough verified evidence");
  } finally { w.app.db.close(); }
});

test("replay warnings cannot be upgraded by the model's claims", async () => {
  const w = world();
  try {
    saveReviewActivities(w.app, w.layoutId, ["prose"]);
    const { review } = createReview(w.app, w.layoutId, "manual");
    let calls = 0;
    const m = model();
    const done = await runReviewAi(w.app, review.id, { ...m.deps, workload: { replay: async () => { const r = reports(); if (++calls === 2) r.warnings.push("An output-affecting behavior was omitted"); return r; } } });
    expect(done.workload?.comparisons[0]).toMatchObject({ verdict: "inconclusive", tasks: [{ status: "warning-tainted", physicalKeydowns: null }] });
    expect(done.items.find((i) => i.kind === "suggestion")?.body).not.toContain("50%");
  } finally { w.app.db.close(); }
});

test("measurement does not require a model provider", async () => {
  const w = world();
  try {
    saveReviewActivities(w.app, w.layoutId, ["prose"]);
    const { review } = createReview(w.app, w.layoutId, "manual");
    const done = await runReviewAi(w.app, review.id, { ...noModel, workload: { replay: async () => reports() } });
    expect(done.ai.status).toBe("unavailable");
    expect(done.workload).toMatchObject({ status: "done", baseline: [{ status: "verified" }] });
  } finally { w.app.db.close(); }
});

test("profiles validate before writing and cannot change in the middle of a run", async () => {
  const w = world();
  try {
    expect(() => saveReviewActivities(w.app, w.layoutId, ["gaming"])).toThrow("invalid review activities");
    expect(() => saveReviewActivities(w.app, w.layoutId, ["prose", "prose"])).toThrow("choose each activity once");
    expect(reviewActivities(w.app.db, w.layoutId)).toEqual([]);
    saveReviewActivities(w.app, w.layoutId, ["prose"]);
    const { review } = createReview(w.app, w.layoutId, "manual");
    const done = await runReviewAi(w.app, review.id, { ...noModel, workload: { replay: async () => {
      expect(() => saveReviewActivities(w.app, w.layoutId, ["json"])).toThrow("still running");
      return reports();
    } } });
    expect(done.workload?.activities).toEqual(["prose"]);
    saveReviewActivities(w.app, w.layoutId, []);
    expect(reviewActivities(w.app.db, w.layoutId)).toEqual([]);
  } finally { w.app.db.close(); }
});

test("a head changed during measurement never receives old suggestions", async () => {
  const w = world();
  try {
    saveReviewActivities(w.app, w.layoutId, ["prose"]);
    const { review } = createReview(w.app, w.layoutId, "manual");
    const m = model();
    let calls = 0;
    const done = await runReviewAi(w.app, review.id, { ...m.deps, workload: { replay: async () => {
      if (++calls === 2) applyOps(w.app, w.layoutId, { baseRevisionId: w.revisionId, summary: "Concurrent change", ops: [{ op: "setBinding", at: { layerId: "base", position: 12 }, binding: key("F17") }] });
      return reports();
    } } });
    expect(done.ai.status).toBe("failed");
    expect(done.items.some((i) => i.kind === "suggestion")).toBe(false);
    expect(w.app.db.query("SELECT count(*) AS n FROM change_sets WHERE status = 'proposed'").get()).toEqual({ n: 0 });
  } finally { w.app.db.close(); }
});

test("selected suites are a deterministic union with distinct task IDs", () => {
  const suite = selectedReviewSuite(["prose", "shortcuts"]);
  expect(suite.tasks.map((t) => t.id)).toEqual(["prose-prose", "shortcuts-copy-control", "shortcuts-command-palette", "shortcuts-navigation"]);
});

test("a proposal touching a pin is withdrawn before candidate replay", async () => {
  const w = world();
  try {
    recordPriority(w.app, w.layoutId, { priorityKind: "pinned", statement: "Leave the spare key empty", subject: { slots: [{ layerId: "base", position: 11 }] } });
    saveReviewActivities(w.app, w.layoutId, ["prose"]);
    const { review } = createReview(w.app, w.layoutId, "manual");
    const m = model();
    let calls = 0;
    const done = await runReviewAi(w.app, review.id, { ...m.deps, workload: { replay: async () => { calls++; return reports(); } } });
    expect(calls).toBe(1);
    expect(done.items.some((i) => i.kind === "suggestion")).toBe(false);
    expect(done.workload?.comparisons).toEqual([]); // Pins are now refused before a proposal can be saved.
    expect(m.requests.flatMap((r) => r.toolResults).join(" ")).toContain("pinned");
    expect(w.app.db.query("SELECT count(*) AS n FROM change_sets WHERE status = 'proposed'").get()).toEqual({ n: 0 });
  } finally { w.app.db.close(); }
});

test("cancellation during baseline stops before model calls or proposals", async () => {
  const w = world();
  try {
    const controller = new AbortController();
    saveReviewActivities(w.app, w.layoutId, ["prose", "shortcuts"]);
    const { review } = createReview(w.app, w.layoutId, "manual");
    const m = model();
    let calls = 0;
    const done = await runReviewAi(w.app, review.id, { ...m.deps, workload: { replay: async () => { calls++; controller.abort(); return reports(); } } }, { signal: controller.signal });
    expect(calls).toBe(1);
    expect(m.requests).toHaveLength(0);
    expect(done.ai.status).toBe("failed");
    expect(done.workload?.status).toBe("failed");
  } finally { w.app.db.close(); }
});

test("the workload deadline during candidate replay withdraws proposals instead of completing the review", async () => {
  const w = world();
  const deadline = new AbortController();
  const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  try {
    saveReviewActivities(w.app, w.layoutId, ["prose"]);
    const { review } = createReview(w.app, w.layoutId, "manual");
    let calls = 0;
    const done = await runReviewAi(w.app, review.id, { ...model().deps, workload: { replay: async () => {
      if (++calls === 2) deadline.abort();
      return reports();
    } } });
    expect(calls).toBe(2);
    expect(done.ai.status).toBe("failed");
    expect(done.items.some((item) => item.kind === "suggestion")).toBe(false);
    expect(done.workload?.comparisons).toEqual([]);
    expect(w.app.db.query("SELECT count(*) AS n FROM change_sets WHERE status = 'proposed'").get()).toEqual({ n: 0 });
  } finally { timeout.mockRestore(); w.app.db.close(); }
});

test("candidate regressions are reported instead of being relabeled as improvements", async () => {
  const w = world();
  try {
    saveReviewActivities(w.app, w.layoutId, ["prose"]);
    const { review } = createReview(w.app, w.layoutId, "manual");
    const m = scriptedModel([{ blocks: [{ tool: "propose_changes", input: {
      title: "Move W to the layer", ops: [
        { op: "setBinding", at: { layerId: "base", position: 0 }, binding: none },
        { op: "setBinding", at: { layerId: "symbols", position: 1 }, binding: key("W") },
      ], explanation: "A deliberately worse test candidate.", tradeoffs: { gains: [], costs: ["more layer switching"] }, decisionDraft: draft(),
    } }] }, (seen) => submit([{ kind: "suggestion", code: "bad-move", title: "Much better", body: "Definitely better.", proposalId: savedId(seen.toolResults) }]), finished]);
    const done = await runReviewAi(w.app, review.id, { ...m.deps, workload: { replay: async () => reports() } });
    expect(done.workload?.comparisons[0]?.verdict).toBe("regression");
    expect(done.items.find((i) => i.kind === "suggestion")?.body).toContain("Costs more");
    expect(done.items.find((i) => i.kind === "suggestion")?.body).not.toContain("Definitely");
  } finally { w.app.db.close(); }
});

test("activity selection reruns the same revision and disabling tests clears old evidence", async () => {
  const w = world();
  let calls = 0;
  const engine = new ReviewEngine(w.app, { ...noModel, workload: { replay: async () => { calls++; return reports(); } } });
  try {
    const first = await engine.review(w.layoutId, "manual", { activities: ["prose"] }).done;
    expect(first.workload?.baseline[0]?.status).toBe("verified");
    expect(calls).toBe(1);
    const disabled = await engine.review(w.layoutId, "manual", { activities: [] }).done;
    expect(disabled.id).toBe(first.id);
    expect(disabled.workload).toBeUndefined();
    expect(reviewActivities(w.app.db, w.layoutId)).toEqual([]);
    expect(calls).toBe(1);
  } finally { await engine.stop(); w.app.db.close(); }
});

test("resetting a changed review snapshot never exposes the previous activity measurements as current", async () => {
  const w = world();
  try {
    saveReviewActivities(w.app, w.layoutId, ["prose"]);
    const first = createReview(w.app, w.layoutId, "manual").review;
    const measured = await runReviewAi(w.app, first.id, { ...noModel, workload: { replay: async () => reports() } });
    expect(measured.workload?.baseline[0]?.status).toBe("verified");
    saveReviewActivities(w.app, w.layoutId, ["shortcuts"]);
    const reset = createReview(w.app, w.layoutId, "manual").review;
    expect(reset.freshness?.current).toBe(true);
    expect(reset.workload).toMatchObject({ status: "pending", activities: ["shortcuts"], baseline: [], comparisons: [] });
  } finally { w.app.db.close(); }
});

test("the automatic import trigger runs selected workloads once without a connected keyboard", async () => {
  const w = world();
  let calls = 0;
  let clock = 0;
  const engine = new ReviewEngine(w.app, { ...noModel, workload: { replay: async () => { calls++; return reports(); } } }, { quietMs: 0, tickMs: 600_000, now: () => clock });
  try {
    saveReviewActivities(w.app, w.layoutId, ["prose"]);
    engine.start();
    clock = Date.now() + 1000;
    await engine.tick();
    await engine.tick();
    expect(calls).toBe(1);
    expect(engine.show(w.layoutId).review).toMatchObject({ trigger: "import", workload: { baseline: [{ status: "verified" }] } });
  } finally { await engine.stop(); w.app.db.close(); }
});

test("a bounded review tests every visible suggestion and withdraws surplus proposals", async () => {
  const w = world();
  try {
    applyOps(w.app, w.layoutId, { baseRevisionId: w.revisionId, summary: "Independent duplicates retain every original function", ops: ["base", "symbols"].flatMap((layerId) => [11, 12, 13].map((position, i) => ({ op: "setBinding" as const, at: { layerId, position }, binding: key(`F${17 + i}`) }))) });
    saveReviewActivities(w.app, w.layoutId, ["prose"]);
    const { review } = createReview(w.app, w.layoutId, "manual");
    const ids: string[] = [];
    const duplicate = (code: string, position: number) => ({ blocks: [{ tool: "propose_changes", input: {
      title: `Duplicate ${code}`, ops: [{ op: "setBinding", at: { layerId: "base", position }, binding: key(code) }],
      explanation: "Synthetic independent candidate.", tradeoffs: { gains: [], costs: [] }, decisionDraft: draft(), supersedes: null,
    } }] });
    const m = scriptedModel([duplicate("E", 11),
      (seen) => { ids.push(savedId(seen.toolResults)); return duplicate("W", 12); },
      (seen) => { ids.push(savedId(seen.toolResults)); return duplicate("S", 13); },
      (seen) => { ids.push(savedId(seen.toolResults)); return submit(ids.map((id, i) => ({ kind: "suggestion", code: `change-${i}`, title: "Try it", body: "Try it.", proposalId: id }))); },
      finished,
    ]);
    let calls = 0;
    const done = await runReviewAi(w.app, review.id, { ...m.deps, workload: { replay: async () => { calls++; return reports(); } } });
    expect(done.items.filter((i) => i.kind === "suggestion")).toHaveLength(2);
    expect(done.workload?.comparisons).toHaveLength(2);
    expect(calls).toBe(3);
    expect(findChangeSet(w.app.db, ids[2]!)?.status).toBe("rejected");
  } finally { w.app.db.close(); }
});

test("a fresh look withdraws old measured suggestions before starting new work", async () => {
  const w = world();
  try {
    saveReviewActivities(w.app, w.layoutId, ["prose"]);
    const { review } = createReview(w.app, w.layoutId, "manual");
    const first = await runReviewAi(w.app, review.id, { ...model().deps, workload: { replay: async () => reports() } });
    const proposalId = first.items.find((item) => item.kind === "suggestion")!.proposalId!;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const empty = scriptedModel([submit([]), finished]);
    const rerun = runReviewAi(w.app, review.id, { model: async () => { await held; return empty.model; }, workload: { replay: async () => reports() } }, { force: true });
    expect(findChangeSet(w.app.db, proposalId)?.status).toBe("rejected");
    expect(showReview(w.app, w.layoutId).review?.items.some((item) => item.kind === "suggestion")).toBe(false);
    release();
    expect((await rerun).ai.status).toBe("done");
  } finally { w.app.db.close(); }
});

test("a profile can be changed after the existing review lease has expired", () => {
  const w = world();
  try {
    const { review } = createReview(w.app, w.layoutId, "manual");
    expect(claimAi(w.app.db, review.id, 0, 600_000)).toBe(true);
    expect(saveReviewActivities(w.app, w.layoutId, ["prose"])).toEqual(["prose"]);
  } finally { w.app.db.close(); }
});

test("a later revision gets its own measurement rather than inheriting an approval", async () => {
  const w = world();
  let calls = 0;
  const engine = new ReviewEngine(w.app, { ...noModel, workload: { replay: async () => { calls++; return reports(); } } });
  try {
    const first = await engine.review(w.layoutId, "manual", { activities: ["prose"] }).done;
    applyOps(w.app, w.layoutId, { baseRevisionId: w.revisionId, summary: "Direct E", ops: [{ op: "setBinding", at: { layerId: "base", position: 11 }, binding: key("E") }] });
    const next = await engine.review(w.layoutId, "apply").done;
    expect(calls).toBe(2);
    expect(next.id).not.toBe(first.id);
    expect(next.workload?.baseline[0]?.physicalKeydowns).toBe(21);
    expect(next.workload?.identity?.revisionId).not.toBe(first.workload?.identity?.revisionId);
    expect(next.workload?.comparisons).toEqual([]);
  } finally { await engine.stop(); w.app.db.close(); }
});

test("new-board activity review waits for the copied mapping to be applied, not its temporary blank", async () => {
  const w = world();
  let clock = 0;
  let calls = 0;
  const engine = new ReviewEngine(w.app, { ...noModel, workload: { replay: async () => { calls++; return reports(); } } }, { quietMs: 0, tickMs: 600_000, now: () => clock });
  try {
    const copied = putConfig(w.app, { from: w.layoutId, board: "moergo/glove80", reviewActivities: ["prose"] });
    engine.start(); clock = Date.now() + 1000;
    await engine.tick();
    expect(engine.show(copied.config.id).review).toBeNull();
    expect(calls).toBe(0);
    applyChange(w.app, copied.proposals[0]!.changeSetId);
    await engine.tick();
    expect(engine.show(copied.config.id).review).toMatchObject({ trigger: "apply", workload: { activities: ["prose"], baseline: [{ id: "prose-prose" }] } });
  } finally { await engine.stop(); w.app.db.close(); }
});
