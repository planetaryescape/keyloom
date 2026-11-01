// Background recommendations have no user mandate to remove behavior. Ordinary editor/chat validation remains unchanged.
import { applyOps } from "../layout/apply-ops.ts";
import { behaviorDescription, preservesCompoundBehavior, preservesNativeBehavior } from "../layout/behavior-facts.ts";
import { deepEqual } from "../layout/equal.ts";
import type { ChangeOp } from "../layout/change.ts";
import type { Layout } from "../layout/schema.ts";
import type { Issue } from "./result.ts";
import { functionHomes, lostFunctions } from "./reachability.ts";

export function automaticReviewErrors(before: Layout, ops: readonly ChangeOp[]): Issue[] {
  const applied = applyOps(before, ops);
  if (!applied.ok) return [];
  const after = applied.layout;
  const errors: Issue[] = [];
  if (before.combos.some((combo) => !deepEqual(combo, after.combos.find((next) => next.id === combo.id)))
    || !deepEqual(before.conditionalLayers, after.conditionalLayers)
    || !deepEqual(before.settings, after.settings)
    || !deepEqual(before.passthrough, after.passthrough)
    || before.layers.some((layer) => !deepEqual(layer.sensorBindings, after.layers.find((next) => next.id === layer.id)?.sensorBindings))) {
    errors.push({ code: "review_behavior_loss", message: "Automatic review must preserve existing combos, encoder actions, conditional layers and unmodeled firmware settings/source. Changes to these require an explicit user request.",
      plain: "This automatic suggestion changes existing behavior outside its supported preservation checks. Ask for it explicitly in a conversation." });
  }
  const retargeted = new Set<string>();
  for (const layer of before.layers) for (const [position, binding] of layer.bindings.entries()) {
    const next = after.layers.find((l) => l.id === layer.id)?.bindings[position];
    if (binding.kind !== "native") {
      if (!preservesCompoundBehavior(before, binding, after, next)) errors.push({
        code: "review_behavior_loss", slots: [{ layerId: layer.id, position }],
        message: "Automatic review must preserve this key's tap/hold, tap-dance and macro actions. Keeping an output elsewhere is not permission to strip this key's behavior.",
        plain: "This suggestion removes or replaces an action on a compound key. It needs your decision in a conversation.",
      });
      continue;
    }
    if (preservesNativeBehavior(before, binding, after, next)) {
      if (next?.kind === "native" && next.source !== binding.source) retargeted.add(`native:${binding.firmware}:${binding.source}`);
    } else errors.push({
      code: "review_behavior_loss", slots: [{ layerId: layer.id, position }],
      message: `Automatic review must preserve every tap/hold effect of ${binding.source}. Retarget its proven layer parameter without replacing the behavior, or leave it unchanged. A dropFunction reason is not user permission.`,
      plain: "This automatic suggestion would replace custom behavior without proving its tap and hold are preserved. It needs your decision in a conversation.",
    });
  }
  for (const lost of lostFunctions(functionHomes(before), functionHomes(after))) {
    if (retargeted.has(lost.function)) continue;
    errors.push({ code: "review_function_loss", function: lost.function, slots: lost.was,
      message: `Automatic review cannot drop ${lost.function}. A model-written dropFunction reason is not a user request. Preserve it, or leave this suggestion for a conversation.`,
      plain: "This suggestion removes an existing function without your request. Automatic review must preserve it." });
  }
  return errors;
}

export function automaticProposalDescription(before: Layout, ops: readonly ChangeOp[]) {
  const applied = applyOps(before, ops);
  if (!applied.ok) throw new Error("Cannot describe an invalid automatic proposal");
  const after = applied.layout;
  const lines: string[] = [];
  let title = "Review a source-checked config change";
  for (const layer of after.layers) for (const [position, next] of layer.bindings.entries()) {
    const old = before.layers.find((l) => l.id === layer.id)?.bindings[position];
    if (!deepEqual(old, next)) {
      if (!lines.length) title = next.kind === "key" ? `Set ${next.code} on ${layer.name}` : next.kind === "native" ? `Retarget a custom key on ${layer.name}` : `Change a key on ${layer.name}`;
      lines.push(`{key:${layer.id}:${position}}: ${behaviorDescription(before, old)} → ${behaviorDescription(after, next)}.`);
    }
  }
  for (const profile of after.holdTapProfiles) {
    const previous = before.holdTapProfiles.find((p) => p.id === profile.id);
    if (!deepEqual(previous, profile)) {
      if (!lines.length) title = `Review ${profile.name} tap/hold settings`;
      lines.push(`Tap/hold profile ${profile.id}: ${JSON.stringify(previous?.options ?? {})} → ${JSON.stringify(profile.options)}. These are source settings, not proof of better rolls or chords.`);
    }
  }
  const explanation = `${lines.join(" ") || "Update the declared config settings."} Source-derived change only; consult the separate runtime-test coverage.`;
  return {
    title: title.slice(0, 100),
    explanation,
    tradeoffs: { gains: ["The declared changes are shown from the source, not inferred from a legend."], costs: ["Runtime behavior, typing speed and comfort are not established by this source check."] },
    decisionDraft: { goal: "Review an automatic config suggestion.", choice: explanation.slice(0, 300), reason: "This automatic proposal describes source-derived effects; it does not record an unstated user preference or a proven runtime benefit.", scope: { apps: [], habits: [] } },
  };
}
