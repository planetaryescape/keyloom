// A layout to review and a scripted model to review it with (D-340). The layout is the Option-on-S fixture, whose two empty keys give
// the checks one stable hint to follow from revision to revision; the model is the real Anthropic adapter over a fake network.
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import type { AgentModel } from "../../src/agent/model.ts";
import { applyOps, getLayout } from "../../src/app/index.ts";
import type { ReviewAiDeps, ReviewEvent } from "../../src/app/review.ts";
import { ModelError } from "../../src/app/errors.ts";
import { type ScriptStep, type ScriptedReply, fakeAnthropic } from "./fake-anthropic.ts";
import { draft, setKey } from "./ops.ts";
import { optionOptionApp } from "./option-option.ts";

export const EMPTY_KEYS_ID = "check:keys_do_nothing::layer-0/33,layer-0/36";

/** Puts F17 on an empty key of layer 0 (33 or 36): the hint about empty keys changes or goes. */
export function fillKey(app: Parameters<typeof applyOps>[0], layoutId: string, position: number): string {
  return applyOps(app, layoutId, {
    baseRevisionId: getLayout(app, layoutId).revision.id, summary: `Layer 0, key ${position}: F17`,
    ops: [{ op: "setBinding", at: { layerId: "layer-0", position }, binding: { kind: "key", code: "F17" } }],
  }).revisionId;
}

let touches = 0;
/** A change that leaves the checks' findings alone: the next revision, for a test that needs one. */
export function touch(app: Parameters<typeof applyOps>[0], layoutId: string): string {
  const code = ["F17", "F18", "F19"][touches++ % 3] as string;
  return applyOps(app, layoutId, { baseRevisionId: getLayout(app, layoutId).revision.id, ops: setKey(6, code), summary: `Layer 0, key 7: ${code}` }).revisionId;
}

export async function reviewWorld() {
  const ctx = await optionOptionApp();
  const events: ReviewEvent[] = [];
  return { ...ctx, events, emit: (e: ReviewEvent) => void events.push(e) };
}

/** A model that is the real adapter over scripted replies; `requests` is what it was sent. */
export function scriptedModel(script: ScriptStep[]): { deps: ReviewAiDeps; model: AgentModel; requests: ReturnType<typeof fakeAnthropic>["requests"] } {
  const fake = fakeAnthropic(script);
  const model = anthropicModel(fake.client);
  return { deps: { model: async () => model }, model, requests: fake.requests };
}

export const noModel: ReviewAiDeps = {
  model: async () => {
    throw new ModelError("missing_key", "No model provider is set up. Set ANTHROPIC_API_KEY, set OPENROUTER_API_KEY, or run `codex login`.");
  },
};

const SET_F17 = { op: "setBinding", at: { layerId: "layer-0", position: 33 }, binding: { kind: "key", code: "F17" } };

export const proposeStep: ScriptedReply = {
  blocks: [{
    tool: "propose_changes",
    input: { alternatives: [{ title: "Put F17 on the empty key", ops: [SET_F17], explanation: "That key does nothing now.", tradeoffs: { gains: ["a used key"], costs: [] }, decisionDraft: draft() }] },
  }],
};

/** The change set the previous step's propose_changes saved, read from the tool's own answer. */
export const savedId = (toolResults: string[]): string => /saved as (cs_\w+)/.exec(toolResults.join("\n"))?.[1] ?? "none";

export type Finding = {
  kind: "problem" | "hint" | "suggestion"; code: string; title: string; body: string;
  keys?: Array<{ layerId: string; position: number }>; layers?: string[]; proposalId?: string; fixes?: string[];
};
export const submit = (items: Finding[]): ScriptedReply => ({
  blocks: [{ tool: "submit_review", input: { items: items.map((f) => ({ keys: [], layers: [], fixes: [], ...f })) } }],
});

/** What the model says after submit_review: the tool runner asks once more, and the review is whatever was submitted. */
export const finished: ScriptedReply = { blocks: [{ text: "Done." }] };
