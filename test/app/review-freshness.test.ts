import { expect, test } from "bun:test";
import { createReview, runReviewAi, showReview } from "../../src/app/review.ts";
import { recordPriority } from "../../src/app/decisions.ts";
import { finished, savedId, scriptedModel, submit } from "../helpers/review-world.ts";
import { groundedWorld, retargetMode } from "../helpers/grounded-review.ts";
import { draft } from "../helpers/ops.ts";
import { applyChange, listChanges, showChange } from "../../src/app/changes.ts";
import type { AgentModel } from "../../src/agent/model.ts";
import { deleteConfig } from "../../src/app/configs.ts";
import { getLayout } from "../../src/app/layouts.ts";
import { claimAi, findReview, invalidateReview, saveReviewDevice } from "../../src/persistence/reviews.ts";
import { Database } from "bun:sqlite";
import { join } from "node:path";

test("changing a saved priority invalidates the review without a revision change or a model call", async () => {
  const w = groundedWorld();
  try {
    const first = createReview(w.app, w.layoutId, "manual").review;
    await runReviewAi(w.app, first.id, scriptedModel([{ blocks: [{ tool: "propose_changes", input: {
      title: "Retarget", ops: retargetMode(), explanation: "Retarget", tradeoffs: { gains: [], costs: [] }, decisionDraft: draft(),
    } }] }, (seen) => submit([{ kind: "suggestion", code: "retarget", title: "Retarget", body: "Retarget", proposalId: savedId(seen.toolResults) }]), finished]).deps);
    expect(showReview(w.app, w.layoutId).review?.items.some((i) => i.source === "agent")).toBe(true);
    expect(showReview(w.app, w.layoutId).review?.freshness?.current).toBe(true);
    recordPriority(w.app, w.layoutId, { priorityKind: "pinned", statement: "Keep this empty", subject: { slots: [{ layerId: "base", position: 2 }] } });
    const changed = showReview(w.app, w.layoutId).review!;
    expect(changed.revisionId).toBe(first.revisionId);
    expect(changed.freshness?.current).toBe(false);
    expect(changed.items.filter((i) => i.source === "agent")).toEqual([]);
    expect(changed.freshness?.reason).toContain("changed");
    const refreshed = createReview(w.app, w.layoutId, "manual").review;
    expect(refreshed.freshness?.current).toBe(true);
    expect(refreshed.ai.status).toBe("pending");
    const done = await runReviewAi(w.app, refreshed.id, scriptedModel([submit([]), finished]).deps);
    expect(done.freshness?.current).toBe(true);
    expect(done.ai.status).toBe("done");
  } finally { w.app.db.close(); }
});

test("a config with linked automatic proposals can still be deleted", async () => {
  const w = groundedWorld();
  try {
    const first = createReview(w.app, w.layoutId, "manual").review;
    await runReviewAi(w.app, first.id, scriptedModel([{ blocks: [{ tool: "propose_changes", input: {
      title: "Retarget", ops: retargetMode(), explanation: "Retarget", tradeoffs: { gains: [], costs: [] }, decisionDraft: draft(),
    } }] }, submit([]), finished]).deps);
    expect(listChanges(w.app, w.layoutId)).toHaveLength(1);
    saveReviewDevice(w.app.db, w.layoutId, "synthetic-marker", true);
    w.app.db.query("DELETE FROM board_config WHERE layout_id = ?").run(w.layoutId);
    expect(deleteConfig(w.app, w.layoutId, "workload-test").id).toBe(w.layoutId);
    expect(() => getLayout(w.app, w.layoutId)).toThrow("no layout");
  } finally { w.app.db.close(); }
});

test("a superseded in-flight reviewer cannot save or overwrite the replacement review", async () => {
  const w = groundedWorld();
  try {
    const oldModel = scriptedModel([{ blocks: [{ tool: "propose_changes", input: {
      title: "Old patch", ops: retargetMode(), explanation: "Old", tradeoffs: { gains: [], costs: [] }, decisionDraft: draft(),
    } }] }, submit([]), finished]);
    const waiting = Promise.withResolvers<AgentModel>();
    const reached = Promise.withResolvers<void>();
    const first = createReview(w.app, w.layoutId, "manual").review;
    const events: string[] = [];
    const old = runReviewAi(w.app, first.id, { model: () => { reached.resolve(); return waiting.promise; } }, { emit: (e) => events.push(e.aiStatus) });
    await reached.promise;
    recordPriority(w.app, w.layoutId, { priorityKind: "pinned", statement: "Keep empty", subject: { slots: [{ layerId: "base", position: 2 }] } });
    const next = createReview(w.app, w.layoutId, "manual").review;
    await runReviewAi(w.app, next.id, scriptedModel([submit([]), finished]).deps);
    waiting.resolve(oldModel.model);
    await old;
    expect(events).toEqual(["running"]);
    const final = showReview(w.app, w.layoutId).review!;
    expect(final.ai.status).toBe("done");
    expect(final.ai.reason).toBeNull();
    expect(final.freshness?.current).toBe(true);
    expect(final.items.filter((i) => i.source === "agent")).toEqual([]);
    expect(listChanges(w.app, w.layoutId).filter((c) => c.source === "agent")).toEqual([]);
  } finally { w.app.db.close(); }
});

test("outcome-question bookkeeping neither invalidates nor recomputes the meaning of constraints", () => {
  const w = groundedWorld();
  try {
    const priority = recordPriority(w.app, w.layoutId, { priorityKind: "pinned", statement: "Keep this", subject: { slots: [{ layerId: "base", position: 2 }] } });
    createReview(w.app, w.layoutId, "manual");
    w.app.db.query("UPDATE decisions SET outcome_asked_at = 100, updated_at = 101 WHERE id = ?").run(priority.decision.id);
    expect(showReview(w.app, w.layoutId).review?.freshness.current).toBe(true);
    w.app.db.query("UPDATE decisions SET goal = 'A different constraint' WHERE id = ?").run(priority.decision.id);
    expect(showReview(w.app, w.layoutId).review?.freshness.current).toBe(false);
  } finally { w.app.db.close(); }
});

test("a constraint write from another SQLite connection invalidates the cached snapshot", () => {
  const w = groundedWorld();
  const other = new Database(join(w.dir, "keyloom.db"), { strict: true });
  try {
    const { decision } = recordPriority(w.app, w.layoutId, { priorityKind: "pinned", statement: "Keep", subject: { slots: [{ layerId: "base", position: 2 }] } });
    createReview(w.app, w.layoutId, "manual");
    expect(showReview(w.app, w.layoutId).review?.freshness.current).toBe(true);
    other.query("UPDATE decisions SET goal = 'Changed externally' WHERE id = ?").run(decision.id);
    expect(showReview(w.app, w.layoutId).review?.freshness.current).toBe(false);
  } finally { other.close(); w.app.db.close(); }
});

test("an invalidated row cannot acquire a writer and a reset clears old fixed markers", () => {
  const w = groundedWorld();
  try {
    const first = createReview(w.app, w.layoutId, "manual").review;
    w.app.db.query("UPDATE board_reviews SET fixed = ? WHERE id = ?").run(JSON.stringify(first.items), first.id);
    invalidateReview(w.app.db, first.id, "Disconnected");
    expect(claimAi(w.app.db, first.id, Date.now(), 0, { force: true })).toBe(false);
    createReview(w.app, w.layoutId, "manual");
    expect(findReview(w.app.db, first.id)?.fixed).toEqual([]);
  } finally { w.app.db.close(); }
});

test("a saved automatic proposal cannot be applied after its constraints change", async () => {
  const w = groundedWorld();
  try {
    const first = createReview(w.app, w.layoutId, "manual").review;
    const model = scriptedModel([{ blocks: [{ tool: "propose_changes", input: {
      title: "Retarget", ops: retargetMode(), explanation: "Retarget", tradeoffs: { gains: [], costs: [] }, decisionDraft: draft(),
    } }] }, (seen) => submit([{ kind: "suggestion", code: "retarget", title: "Retarget", body: "Retarget", proposalId: savedId(seen.toolResults) }]), finished]);
    const done = await runReviewAi(w.app, first.id, model.deps);
    const id = done.items.find((i) => i.proposalId)?.proposalId!;
    expect(showChange(w.app, id).status).toBe("proposed");
    recordPriority(w.app, w.layoutId, { priorityKind: "pinned", statement: "Do not change my mode key", subject: { slots: [{ layerId: "base", position: 0 }] } });
    expect(() => applyChange(w.app, id)).toThrow("fresh review");
  } finally { w.app.db.close(); }
});
