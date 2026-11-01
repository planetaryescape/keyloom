// Offline republication of captured synthetic candidates. No provider, device or emulator calls.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { ChangeOpSchema } from "../src/layout/change.ts";
import { createReview, runReviewAi } from "../src/app/review.ts";
import { recordPriority } from "../src/app/decisions.ts";
import { groundedLayout } from "../test/helpers/grounded-review.ts";
import { workloadApp } from "../test/helpers/workload.ts";
import { draft } from "../test/helpers/ops.ts";
import { finished, scriptedModel, submit } from "../test/helpers/review-world.ts";

const Report = z.object({ scenario: z.enum(["misleading-legend", "missing-layer-route", "unknown-custom-effect", "pinned-keys"]), proposals: z.array(z.object({ ops: ChangeOpSchema.array() })) });
const directory = join(import.meta.dir, "reports");
const results = [];
for (const file of [...new Bun.Glob("2026-11-01*-codex-grounded-*.json").scanSync(directory)].sort()) {
  const raw = await Bun.file(join(directory, file)).text();
  const captured = Report.parse(JSON.parse(raw));
  const doc = groundedLayout();
  if (captured.scenario !== "missing-layer-route") doc.layers[0]!.bindings[2] = { kind: "layer", action: "momentary", layerId: "tools" };
  if (captured.scenario === "unknown-custom-effect") {
    doc.layers[0]!.bindings[0] = { kind: "native", firmware: "zmk", source: "&unknown_effect", label: "Unused" };
    doc.layers[0]!.bindings[3] = { kind: "layer", action: "momentary", layerId: "factory" };
    doc.passthrough = [];
  }
  const w = workloadApp(doc);
  try {
    if (captured.scenario === "missing-layer-route" && captured.proposals.length) recordPriority(w.app, w.layoutId, { priorityKind: "frequent", statement: "I need the Tools layer reachable. Keep the custom key unchanged.", subject: { slots: [{ layerId: "tools", position: 1 }] } });
    if (captured.scenario === "pinned-keys") recordPriority(w.app, w.layoutId, { priorityKind: "pinned", statement: "Keep my base layer unchanged", subject: { slots: Array.from({ length: 80 }, (_, position) => ({ layerId: "base", position })) } });
    const model = scriptedModel([
      ...captured.proposals.map((p) => ({ blocks: [{ tool: "propose_changes", input: { title: "Captured candidate", ops: p.ops, explanation: "Captured synthetic operations", tradeoffs: { gains: [], costs: [] }, decisionDraft: draft() } }] })),
      submit([]), finished,
    ]);
    const result = await runReviewAi(w.app, createReview(w.app, w.layoutId, "manual").review.id, model.deps);
    if (result.ai.status !== "done") throw new Error(`Offline publication failed for ${file}`);
    results.push({ originalReport: file, originalSha256: createHash("sha256").update(raw).digest("hex"),
      capturedCandidates: captured.proposals.length, proposalPreservation: captured.proposals.length ? "source-gate-exercised" : "not-exercised; captured model abstained",
      suggestions: result.items.filter((i) => i.kind === "suggestion").map(({ title, body, fixes }) => ({ title, body, fixes })),
      sourceFindings: result.items.filter((i) => i.source === "check").map(({ id, code }) => ({ id, code })),
    });
  } finally { w.app.db.close(); }
}
await Bun.write(join(directory, "grounded-review-offline-republication.json"), JSON.stringify({ mode: "offline scripted republication of captured operations, not a new live evaluation", liveProviderCalls: 0, firmwareReplays: 0, hardwareAccess: false, results }, null, 2) + "\n");
console.log(`Re-published ${results.length} historical reports without a live provider or device.`);
