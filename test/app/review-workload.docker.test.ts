// Run through agent-work with KEYLOOM_DOCKER_TESTS=qmk|zmk|1. Real firmware, scripted provider, no device access.
import { expect, test } from "bun:test";
import { getLayout } from "../../src/app/layouts.ts";
import { createReview, runReviewAi } from "../../src/app/review.ts";
import { REVIEW_WORKLOAD_TIMEOUT_MS, saveReviewActivities } from "../../src/app/review-workloads.ts";
import { findChangeSet } from "../../src/persistence/change-sets.ts";
import { draft } from "../helpers/ops.ts";
import { finished, savedId, scriptedModel, submit } from "../helpers/review-world.ts";
import { key, none, tinyLayout, workloadApp } from "../helpers/workload.ts";

const mode = process.env.KEYLOOM_DOCKER_TESTS;
for (const [firmware, boardId] of [["qmk", "zsa/moonlander"], ["zmk", "moergo/glove80"]] as const) {
  const check = mode === "1" || mode === firmware ? test : test.skip;
  check(`automatic review independently verifies a proposed improvement through the real ${firmware} core`, async () => {
    const base = ["W", "S", "A", "M", "L", "T", "R", "DOT", "ENTER", "SPACE"].map(key);
    base.push({ kind: "layer", action: "momentary", layerId: "symbols" }, none);
    const layout = tinyLayout(base, [key("E"), ...Array.from({ length: 11 }, () => ({ kind: "transparent" as const }))]);
    layout.firmware = firmware; layout.boardId = boardId;
    const { app, layoutId } = workloadApp(layout);
    try {
      const before = getLayout(app, layoutId);
      saveReviewActivities(app, layoutId, ["prose"]);
      const { review } = createReview(app, layoutId, "import");
      const model = scriptedModel([
        { blocks: [{ tool: "propose_changes", input: {
          title: "Direct E", ops: [{ op: "setBinding", at: { layerId: "base", position: 11 }, binding: key("E") }],
          explanation: "Keep the layered E and add a direct route on an empty key.", tradeoffs: { gains: ["direct E"], costs: [] }, decisionDraft: draft(),
        } }] },
        (seen) => submit([{ kind: "suggestion", code: "direct-letter", title: "E without a layer hold", body: "The app must verify this candidate.",
          keys: [{ layerId: "base", position: 11 }], layers: ["base"], proposalId: savedId(seen.toolResults) }]),
        finished,
      ]);
      // No WorkloadDeps override: both snapshots execute the production firmware adapter.
      const done = await runReviewAi(app, review.id, model.deps);
      expect(done.ai.status).toBe("done");
      expect(done.workload?.baseline[0]).toMatchObject({ status: "verified", physicalKeydowns: 22, maxSimultaneousKeys: 2 });
      expect(done.workload?.comparisons[0]).toMatchObject({ verdict: "verified-improvement", tasks: [{ status: "verified", physicalKeydowns: 21, maxSimultaneousKeys: 1 }] });
      expect(JSON.stringify(model.requests[0]?.body.messages)).toContain("physical keydowns 22");
      expect(findChangeSet(app.db, done.workload!.comparisons[0]!.proposalId)?.status).toBe("proposed");
      expect(getLayout(app, layoutId)).toEqual(before);
    } finally { app.db.close(); }
  }, REVIEW_WORKLOAD_TIMEOUT_MS + 60_000);
}
