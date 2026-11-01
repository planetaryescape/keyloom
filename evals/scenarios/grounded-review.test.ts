// Live board-review quality: synthetic configs, explicit opt-in, deterministic output oracles (no model judge).
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createReview, runReviewAi } from "../../src/app/review.ts";
import { defaultAgentModel } from "../../src/app/chat-model.ts";
import { listChanges } from "../../src/app/changes.ts";
import { getLayout } from "../../src/app/layouts.ts";
import { recordPriority } from "../../src/app/decisions.ts";
import { applyOps } from "../../src/layout/apply-ops.ts";
import { reviewChecks } from "../../src/validation/review-checks.ts";
import { groundedLayout } from "../../test/helpers/grounded-review.ts";
import { workloadApp } from "../../test/helpers/workload.ts";
import { evalProvider, live } from "../provider.ts";
import type { ModelMessage } from "../../src/agent/model.ts";

const scenarios = ["misleading-legend", "missing-layer-route", "unknown-custom-effect", "pinned-keys"] as const;

describe.skipIf(!live)("grounded automatic review", () => {
  for (const scenario of scenarios) test(scenario, async () => {
    const doc = groundedLayout();
    if (scenario !== "missing-layer-route") doc.layers[0]!.bindings[2] = { kind: "layer", action: "momentary", layerId: "tools" };
    if (scenario === "unknown-custom-effect") {
      doc.layers[0]!.bindings[0] = { kind: "native", firmware: "zmk", source: "&unknown_effect", label: "Unused" };
      doc.layers[0]!.bindings[3] = { kind: "layer", action: "momentary", layerId: "factory" };
      doc.passthrough = [];
    }
    const w = workloadApp(doc);
    try {
      if (scenario === "missing-layer-route") recordPriority(w.app, w.layoutId, { priorityKind: "frequent", statement: "I need the Tools layer reachable. Put a momentary Tools hold on the first empty key on Base, leaving my existing custom mode key and its RGB-status tap unchanged.", subject: { slots: [{ layerId: "tools", position: 1 }] } });
      if (scenario === "pinned-keys") recordPriority(w.app, w.layoutId, { priorityKind: "pinned", statement: "Keep my base layer unchanged", subject: { slots: Array.from({ length: 80 }, (_, position) => ({ layerId: "base", position })) } });
      const before = getLayout(w.app, w.layoutId);
      const model = await defaultAgentModel(w.dir, { provider: evalProvider });
      const messages: ModelMessage[] = [];
      const result = await runReviewAi(w.app, createReview(w.app, w.layoutId, "manual").review.id, { model: async () => ({
        provider: model.provider, model: model.model, effort: model.effort, classifyError: (error) => model.classifyError(error),
        run: async (request) => { const response = await model.run(request); messages.push(...response.messages); return response; },
      }) });
      const proposals = listChanges(w.app, w.layoutId).filter((c) => c.source === "agent" && c.status === "proposed");
      const checks = {
        finished: result.ai.status === "done",
        unchangedHead: getLayout(w.app, w.layoutId).revision.id === before.revision.id,
        noInventedStandaloneDiagnosis: result.items.filter((i) => i.source === "agent").every((i) => i.kind === "suggestion" && i.proposalId !== null),
        preservesCustomMeaning: proposals.every((p) => {
          const applied = applyOps(before.document, p.ops);
          return applied.ok && JSON.stringify(applied.layout.layers[0]?.bindings[0]) === JSON.stringify(before.document.layers[0]?.bindings[0]);
        }),
        appropriateAction: scenario === "missing-layer-route" ? proposals.some((p) => {
          const applied = applyOps(before.document, p.ops);
          return applied.ok && !reviewChecks(before.board.definition, applied.layout).items.some((i) => i.code === "layer_unreachable");
        }) : proposals.length === 0,
      };
      const report = { scenario, provider: evalProvider, model: model.model, checks, review: result, proposals, messages };
      const dir = join(import.meta.dir, "../reports");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${new Date().toISOString().replaceAll(":", "-")}-${evalProvider}-grounded-${scenario}.json`), JSON.stringify(report, null, 2));
      expect(Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)).toEqual([]);
    } finally { w.app.db.close(); }
  }, 240_000);
});
