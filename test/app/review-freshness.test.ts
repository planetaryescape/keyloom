import { expect, test } from "bun:test";
import { createReview, runReviewAi, showReview } from "../../src/app/review.ts";
import { recordPriority } from "../../src/app/decisions.ts";
import { finished, savedId, scriptedModel, submit } from "../helpers/review-world.ts";
import { groundedWorld, retargetMode } from "../helpers/grounded-review.ts";
import { draft } from "../helpers/ops.ts";
import { applyChange, listChanges, showChange } from "../../src/app/changes.ts";
import type { AgentModel } from "../../src/agent/model.ts";

test("changing a saved priority invalidates the review without a revision change or a model call", async () => {
  const w = groundedWorld();
  try {
    const first = createReview(w.app, w.layoutId, "manual").review;
    await runReviewAi(w.app, first.id, scriptedModel([submit([]), finished]).deps);
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

test("a superseded in-flight reviewer cannot save or overwrite the replacement review", async () => {
  const w = groundedWorld();
  try {
    const oldModel = scriptedModel([{ blocks: [{ tool: "propose_changes", input: {
      title: "Old patch", ops: retargetMode(), explanation: "Old", tradeoffs: { gains: [], costs: [] }, decisionDraft: draft(),
    } }] }, submit([]), finished]);
    const waiting = Promise.withResolvers<AgentModel>();
    const reached = Promise.withResolvers<void>();
    const first = createReview(w.app, w.layoutId, "manual").review;
    const old = runReviewAi(w.app, first.id, { model: () => { reached.resolve(); return waiting.promise; } });
    await reached.promise;
    recordPriority(w.app, w.layoutId, { priorityKind: "pinned", statement: "Keep empty", subject: { slots: [{ layerId: "base", position: 2 }] } });
    const next = createReview(w.app, w.layoutId, "manual").review;
    await runReviewAi(w.app, next.id, scriptedModel([submit([]), finished]).deps);
    waiting.resolve(oldModel.model);
    await old;
    const final = showReview(w.app, w.layoutId).review!;
    expect(final.ai.status).toBe("done");
    expect(final.ai.reason).toBeNull();
    expect(final.freshness?.current).toBe(true);
    expect(final.items.filter((i) => i.source === "agent")).toEqual([]);
    expect(listChanges(w.app, w.layoutId).filter((c) => c.source === "agent")).toEqual([]);
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
