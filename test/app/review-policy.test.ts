import { expect, test } from "bun:test";
import { createAgentPorts } from "../../src/app/agent-ports.ts";
import { getLayout } from "../../src/app/layouts.ts";
import { openProposalsOutsideChat, proposeChange, showChange } from "../../src/app/changes.ts";
import { draft } from "../helpers/ops.ts";
import { groundedLayout, groundedWorld, retargetMode } from "../helpers/grounded-review.ts";
import { workloadApp } from "../helpers/workload.ts";
import { createReview, runReviewAi } from "../../src/app/review.ts";
import { finished, savedId, scriptedModel, submit } from "../helpers/review-world.ts";
import { recordPriority } from "../../src/app/decisions.ts";

test("an automatic reviewer cannot authorize losing a custom tap by declaring its own dropFunction", () => {
  const w = groundedWorld();
  try {
    const before = getLayout(w.app, w.layoutId);
    const ops = retargetMode();
    ops[0] = { op: "setBinding", at: { layerId: "base", position: 0 }, binding: { kind: "layer", action: "momentary", layerId: "tools" } };
    const result = createAgentPorts(w.app, w.layoutId, null).propose([{
      title: "Definitely a fix", ops, explanation: "Sticky Magic is gone.", tradeoffs: { gains: ["Fixed"], costs: [] }, decisionDraft: draft(),
    }])[0]!;
    expect(result.changeSetId).toBeNull();
    expect(result.validation.errors.some((e) => e.code === "review_behavior_loss")).toBe(true);
    expect(openProposalsOutsideChat(w.app, w.layoutId)).toEqual([]);
    expect(getLayout(w.app, w.layoutId)).toEqual(before);
  } finally { w.app.db.close(); }
});

test("pins constrain automatic review even when no activity tests were selected", () => {
  const w = groundedWorld();
  try {
    recordPriority(w.app, w.layoutId, { priorityKind: "pinned", statement: "Keep this key empty", subject: { slots: [{ layerId: "base", position: 2 }] } });
    const result = createAgentPorts(w.app, w.layoutId, null).check([{ op: "setBinding", at: { layerId: "base", position: 2 }, binding: { kind: "key", code: "B" } }]);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("review_priority");
  } finally { w.app.db.close(); }
});

test("automatic review cannot silently remove a combo merely because its output exists elsewhere", () => {
  const layout = groundedLayout();
  layout.combos = [{ id: "combo-b", name: "B chord", positions: [1, 2], layerIds: ["base"], output: { kind: "key", code: "B" } }];
  layout.layers[0]!.bindings[3] = { kind: "key", code: "B" };
  const w = workloadApp(layout);
  try {
    const result = createAgentPorts(w.app, w.layoutId, null).check([{ op: "removeCombo", comboId: "combo-b" }]);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("review_behavior_loss");
  } finally { w.app.db.close(); }
});

test("the published review cannot reintroduce the model's false explanation after a safe proposal is saved", async () => {
  const w = groundedWorld();
  try {
    const { review } = createReview(w.app, w.layoutId, "manual");
    const m = scriptedModel([{ blocks: [{ tool: "propose_changes", input: {
      title: "Guaranteed faster", ops: retargetMode(), explanation: "Sticky Magic is gone.", tradeoffs: { gains: ["Faster"], costs: [] }, decisionDraft: draft(),
    } }] }, (seen) => submit([{ kind: "suggestion", code: "made-up-story", title: "Guaranteed faster", body: "The sticky tap was wrong; comfort is proven.", proposalId: savedId(seen.toolResults) }]), finished]);
    const result = await runReviewAi(w.app, review.id, m.deps);
    const suggestion = result.items.find((i) => i.kind === "suggestion")!;
    expect(suggestion.body).toContain("indicator");
    expect(suggestion.body).not.toContain("sticky");
    expect(suggestion.body).not.toContain("comfort is proven");
    expect(suggestion.title).not.toContain("Guaranteed");
    expect(suggestion.id).toBe("agent:made-up-story:base,tools:base/0,tools/2");
    expect(result.ai.status).toBe("done");
  } finally { w.app.db.close(); }
});

test("two model findings that resolve to the same real affected key cannot leave an invisible proposal open", async () => {
  const layout = groundedLayout();
  layout.holdTapProfiles = [{ id: "hrm", name: "Home row", firmware: "zmk", options: { "tapping-term-ms": 200 } }];
  layout.layers[0]!.bindings[1] = { kind: "holdTap", tap: { code: "G" }, hold: { mods: ["LGUI"] }, profileId: "hrm" };
  const w = workloadApp(layout);
  try {
    const propose = (term: number) => ({ tool: "propose_changes", input: {
      title: `Term ${term}`, ops: [{ op: "upsertHoldTapProfile", profile: { ...layout.holdTapProfiles[0]!, options: { "tapping-term-ms": term } } }],
      explanation: "A source-only test candidate", tradeoffs: { gains: [], costs: [] }, decisionDraft: draft(),
    } });
    const m = scriptedModel([{ blocks: [propose(180), propose(190)] }, (seen) => {
      const ids = [...seen.toolResults.join("\n").matchAll(/saved as (cs_\w+)/g)].map((match) => match[1]!);
      return submit(ids.map((proposalId, i) => ({ kind: "suggestion", code: "same-profile", title: "Timing", body: "Timing", proposalId,
        keys: [{ layerId: "base", position: i * 2 }] })));
    }, finished]);
    const done = await runReviewAi(w.app, createReview(w.app, w.layoutId, "manual").review.id, m.deps);
    const suggestions = done.items.filter((i) => i.kind === "suggestion");
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.keys).toEqual([{ layerId: "base", position: 1 }]);
    expect(openProposalsOutsideChat(w.app, w.layoutId).map((p) => p.changeSetId)).toEqual([suggestions[0]!.proposalId!]);
  } finally { w.app.db.close(); }
});

test("keeping a modifier elsewhere does not license stripping the hold from its existing tap/hold key", () => {
  const layout = groundedLayout();
  layout.holdTapProfiles = [{ id: "hrm", name: "Home row", firmware: "zmk", options: { flavor: "tap-preferred", "tapping-term-ms": 200 } }];
  layout.layers[0]!.bindings[1] = { kind: "holdTap", tap: { code: "G" }, hold: { mods: ["LGUI"] }, profileId: "hrm" };
  layout.layers[0]!.bindings[2] = { kind: "key", code: "G" };
  layout.layers[0]!.bindings[3] = { kind: "modifier", mods: ["LGUI"] };
  const w = workloadApp(layout);
  try {
    const result = createAgentPorts(w.app, w.layoutId, null).check([{ op: "setBinding", at: { layerId: "base", position: 1 }, binding: { kind: "key", code: "G" } }]);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("review_behavior_loss");
  } finally { w.app.db.close(); }
});

test("automatic review rejects a self-declared ordinary function loss without restricting an explicit editor choice", () => {
  const w = groundedWorld();
  try {
    const ops = [
      { op: "setBinding" as const, at: { layerId: "base", position: 1 }, binding: { kind: "key" as const, code: "B" } },
      { op: "dropFunction" as const, function: "key:A", reason: "The model decided A is unimportant" },
    ];
    const result = createAgentPorts(w.app, w.layoutId, null).check(ops);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("review_function_loss");
    const explicit = proposeChange(w.app, w.layoutId, { ops, explanation: "An explicit replacement for this test.", source: "editor" });
    expect(explicit.validation.ok).toBe(true);
  } finally { w.app.db.close(); }
});

test("a source-preserving retarget is allowed but the app, not the model, describes the effects", () => {
  const w = groundedWorld();
  try {
    const result = createAgentPorts(w.app, w.layoutId, null).propose([{
      title: "Guaranteed comfort", ops: retargetMode(), explanation: "Sticky Magic is gone and typing is faster.",
      tradeoffs: { gains: ["Guaranteed comfort"], costs: ["Sticky Magic removed"] }, decisionDraft: draft(),
    }])[0]!;
    expect(result.validation.ok).toBe(true);
    expect(result.changeSetId).not.toBeNull();
    const saved = showChange(w.app, result.changeSetId!);
    expect(saved.explanation).toContain("indicator");
    expect(saved.explanation).toContain("tools");
    expect(saved.explanation).not.toContain("Sticky");
    expect(saved.explanation).not.toContain("faster");
    expect(saved.tradeoffs.costs.join(" ")).not.toContain("Sticky");
    expect(saved.decisionDraft?.reason).toContain("source");
  } finally { w.app.db.close(); }
});
