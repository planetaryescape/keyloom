// The agent's part of a board review (D-340): one run over the layout and what the checks found, with the tools a conversation has,
// minus the ones that need BK. It proposes through the same path as a conversation (D-014) and applies nothing; what it found comes
// back through `submit_review`, so the structure is the tool's schema and not text to parse.
import { z } from "zod";
import type { ReviewItem } from "../validation/review-item.ts";
import { cleanMarkers, itemId } from "../validation/review-item.ts";
import type { AgentModel, ModelTool, Usage } from "./model.ts";
import { assembleSystemPrompt } from "./prompt.ts";
import review from "./prompts/review.md" with { type: "text" };
import type { AgentPorts, ProposalResult } from "./ports.ts";
import { TurnRecorder } from "./recorder.ts";
import { analyseChangeTool } from "./tools/analyse-change.ts";
import { defineTool } from "./tools/define.ts";
import { findFunctionTool } from "./tools/find-function.ts";
import { getLayoutTool } from "./tools/get-layout.ts";
import { getTypingFindingsTool } from "./tools/get-typing-findings.ts";
import { proposeChangesTool } from "./tools/propose-changes.ts";
import { retargetLayerHoldTool } from "./tools/retarget-layer-hold.ts";

/** Requests to the model, and tool calls across them: the review's budget, since one run is all a revision gets. */
export const REVIEW_MAX_ITERATIONS = 10;
export const REVIEW_MAX_TOOL_CALLS = 14;
export const REVIEW_MAX_ITEMS = 6;

const FindingSchema = z.object({
  kind: z.enum(["problem", "hint", "suggestion"]),
  code: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/).describe("A short kebab-case topic, the same each time the same finding comes up."),
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(400),
  keys: z.array(z.object({ layerId: z.string(), position: z.number().int().nonnegative() })).describe("The keys to mark on the board."),
  layers: z.array(z.string()).describe("Layer ids the finding is about."),
  proposalId: z.string().optional().describe("For a suggestion: the id propose_changes returned. Required."),
  fixes: z.array(z.string()).describe("For a suggestion: ids of the check items (problems or hints) it fixes. Empty otherwise."),
});
const SubmitSchema = z.object({ items: z.array(FindingSchema).max(REVIEW_MAX_ITEMS) });

export type ReviewAgentOutcome =
  | { status: "done"; items: ReviewItem[]; usage: Usage; costUsd?: number; iterations: number }
  /** It stopped without submitting. What it saved before then can still be shown; `limit` says it was the step or tool budget. */
  | { status: "failed"; reason: string; limit: boolean; usage: Usage; costUsd?: number; iterations: number };

const STOP_REASONS: Record<string, string> = {
  refusal: "The model declined to review this layout.",
  max_tokens: "The model's reply was cut off before it finished the review.",
  model_context_window_exceeded: "The layout was too large for the model to review in one go.",
  tool_use: "The model used all its steps without finishing the review.",
};

/** What the model is told the checks already found, with their ids so a suggestion can name the one it fixes. */
export function reviewRequest(layoutName: string, revisionId: string, checks: readonly ReviewItem[]): string {
  const found = checks.length === 0
    ? "The checks found nothing."
    : ["The checks found (already shown to BK; do not restate any of them):", ...checks.map((c) => `- [${c.kind}] id ${c.id} (code ${c.code}): ${c.title}. ${c.body}`)].join("\n");
  return `Review the layout "${layoutName}" at revision ${revisionId}.\n\n${found}`;
}

export async function runReviewAgent(input: { model: AgentModel; ports: AgentPorts; checks: readonly ReviewItem[]; workload?: string; signal?: AbortSignal }): Promise<ReviewAgentOutcome> {
  const { model, ports, checks } = input;
  const snapshot = ports.snapshot();
  const recorder = new TurnRecorder();
  const proposed = new Set<string>();
  let submitted: z.infer<typeof SubmitSchema> | undefined;

  const submit = defineTool({
    name: "submit_review",
    description: "Give keyloom the review: the problems, hints and suggestions worth BK's attention. Call it once, when you are done. An empty list is a valid review.",
    inputSchema: SubmitSchema,
    // Optional fields and a nested array: zod checks the input, as for the tools that take ops.
    strict: false,
    run: (parsed) => {
      submitted = parsed;
      return "Review received. Stop here.";
    },
  });

  let calls = 0;
  const budgeted = (tool: ModelTool): ModelTool => ({
    ...tool,
    run: (raw) => {
      // submit_review is never refused: a model that spent its calls must still be able to hand in what it has.
      if (tool.name !== "submit_review" && ++calls > REVIEW_MAX_TOOL_CALLS) return "You are out of tool calls. Call submit_review now with what you have.";
      return tool.run(raw);
    },
  });
  const tools = [
    getLayoutTool(ports), retargetLayerHoldTool(ports), findFunctionTool(ports), analyseChangeTool(ports, recorder), getTypingFindingsTool(ports),
    proposeChangesTool(ports, recorder, (p: ProposalResult) => {
      if (p.changeSetId !== null) proposed.add(p.changeSetId);
    }),
    submit,
  ].map(budgeted);

  const result = await model.run({
    system: `${assembleSystemPrompt(snapshot.board, snapshot.document, ports.priorities(), ports.choices())}\n\n${review.trim()}`,
    messages: [{ role: "user", content: [{ type: "text", text: `${reviewRequest(snapshot.layoutName, snapshot.revisionId, checks)}${input.workload ? `\n\nIndependent workload measurements:\n${input.workload}` : ""}` }] }],
    tools,
    maxIterations: REVIEW_MAX_ITERATIONS,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const spent = { usage: result.usage, iterations: result.iterations, ...(result.costUsd === undefined ? {} : { costUsd: result.costUsd }) };

  if (submitted === undefined) {
    return { status: "failed", reason: STOP_REASONS[result.stopReason] ?? "The model finished without giving a review.", limit: result.stopReason === "tool_use", ...spent };
  }
  return { status: "done", items: toItems(submitted.items, snapshot.document, snapshot.board.definition.keyCount, checks, proposed), ...spent };
}

const slotSet = (keys: readonly { layerId: string; position: number }[]) => keys.map((k) => `${k.layerId}/${k.position}`).sort().join(",");

/**
 * A finding the checks already made, by what it is about and not by its code or wording: the same kind and keys, and at least all of
 * a check's layers (naming the Magic key as well as the Magic layer is still the Magic layer being unreachable). A finding about
 * nothing in particular restates nothing. The model's insight about a check survives only as a suggestion that fixes it.
 */
function restates(checks: readonly ReviewItem[], kind: ReviewItem["kind"], layers: readonly string[], keys: readonly { layerId: string; position: number }[]): boolean {
  if (kind === "suggestion" || (layers.length === 0 && keys.length === 0)) return false;
  return checks.some((c) =>
    c.kind === kind && ((c.layers.length > 0 && c.layers.every((l) => layers.includes(l))) || ([...c.layers].sort().join(",") === [...layers].sort().join(",") && slotSet(c.keys) === slotSet(keys))));
}

/**
 * The model's findings as items, with everything it could get wrong checked: a suggestion needs a change set saved in this run (it is
 * validated against the head when saved, D-014), keys and layers must exist, and a finding the checks already made is dropped.
 */
function toItems(
  findings: readonly z.infer<typeof FindingSchema>[], doc: { layers: ReadonlyArray<{ id: string; name: string }> }, keyCount: number,
  checks: readonly ReviewItem[], proposed: ReadonlySet<string>,
): ReviewItem[] {
  const layerInfo = new Map(doc.layers.map((l) => [l.id, { name: l.name, keyCount }]));
  const taken = new Set(checks.map((c) => c.id));
  const fixable = new Set(checks.filter((c) => c.kind !== "suggestion").map((c) => c.id));
  const out: ReviewItem[] = [];
  for (const f of findings) {
    const proposalId = f.kind === "suggestion" ? (f.proposalId ?? null) : null;
    if (f.kind === "suggestion" && (proposalId === null || !proposed.has(proposalId))) continue;
    const keys = f.keys.filter((k) => layerInfo.has(k.layerId) && k.position < keyCount);
    const layers = [...new Set(f.layers.filter((id) => layerInfo.has(id)))];
    // The model invents its own codes, so a restated check is found by what it is about: the same kind, layers and keys.
    if (restates(checks, f.kind, layers, keys)) continue;
    const id = itemId({ source: "agent", code: f.code, layers, keys });
    if (taken.has(id)) continue;
    taken.add(id);
    // What a suggestion fixes: a finding of the checks, or a problem or hint this same review reported.
    const fixes = f.kind === "suggestion" ? f.fixes.filter((x) => fixable.has(x)) : [];
    if (f.kind !== "suggestion") fixable.add(id);
    out.push({
      id, source: "agent", kind: f.kind, severity: f.kind === "problem" ? "warning" : "info", code: f.code,
      title: cleanMarkers(f.title, layerInfo), body: cleanMarkers(f.body, layerInfo), keys, layers, proposalId, fixes, dismissedAt: null,
    });
  }
  return out;
}
