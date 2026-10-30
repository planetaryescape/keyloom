import { CopyHandoffSchema } from "../persistence/chat-presentations.ts";
import type { CopyHandoff } from "../agent/ports.ts";
import { z } from "zod";
import type { PutInput } from "../agent/ports.ts";
import { boardContext, choicesContext, prioritiesContext } from "../agent/prompt.ts";
import { listConversationChangeSets } from "../persistence/change-sets.ts";
import { getBoardConfig } from "../persistence/configs.ts";
import { toChoiceFact, toPriorityFact } from "./agent-ports.ts";
import { TransferReportSchema } from "./copy-report.ts";
import { layoutChoices, layoutPriorities } from "./decisions.ts";
import { planPut } from "./keyboard-put.ts";
import { getLayout } from "./layouts.ts";
import type { App } from "./context.ts";

export const CopyContextSchema = z.object({
  version: z.literal(1), parentRunId: z.string(), sourceMessageIds: z.array(z.string()), prompt: z.string(), provenance: z.string().optional(),
  // The card the target's first reply carries (D-467), stored beside the prompt so the child shows the copy's own facts without replanning.
  report: TransferReportSchema.optional(),
});
export type CopyContext = z.infer<typeof CopyContextSchema>;

/** Copy facts remain tied to the revisions that informed the request, including when later answers arrive. */
export function prepareCopyContext(app: App, here: string, input: PutInput, parentRunId: string, sourceMessageIds: string[]) {
  const { view: source, target, plan } = planPut(app, input);
  const current = getLayout(app, here);
  const preferenceId = current.layout.boardId === target.definition.id ? here : getBoardConfig(app.db, target.definition.id);
  const facts = (id: string, label: string) => {
    const view = getLayout(app, id);
    return [
      `## ${label}: ${view.layout.name} (${id}), revision ${view.revision.id}. READ ONLY.`,
      boardContext(view.board),
      prioritiesContext(layoutPriorities(app, id).map(toPriorityFact), view.document, view.board),
      choicesContext(layoutChoices(app, id).map(toChoiceFact), view.document, view.board),
      `Layout at that revision: ${JSON.stringify(view.document)}`,
    ].join("\n\n");
  };
  const provenance = [
    facts(source.layout.id, "Source setup and remembered decisions"),
    preferenceId === undefined ? "No existing target preference config." : facts(preferenceId, "Existing target preference config and remembered decisions"),
  ].join("\n\n");
  const prompt = [
    "# Continue the requested whole-config adaptation on this NEW config",
    "The original request is this conversation's first message. Do not make another config or call put_config. Only this conversation's new config is writable. The source and existing target config stay untouched.",
    "Make ONE best validated proposal with a decision draft before asking a consequential question. Start from the translated seed below and adapt the complete setup to the target board's layout and feel, using both sets of remembered reasons. Preserve reachable layers, carry important missing functions to suitable homes, and explicitly name anything still untranslated or displaced in the proposal costs, including its reason. Use analyse_change and propose_changes. Comfort is a hypothesis; no typing profile or recordings are available. Do not ask about choices you can resolve from these facts. After an answer, revise through supersedes even when the ops stay the same, retaining its reason.",
    provenance,
    `Translated seed (not applied or proposed): ${JSON.stringify({ ops: plan.opsWithPlacements.length ? plan.opsWithPlacements : plan.ops, placements: plan.placements, notCarried: plan.notCarried, layers: plan.layers, combos: plan.combos, notes: plan.notes })}`,
  ].join("\n\n");
  return { source, target, plan, context: { version: 1 as const, parentRunId, sourceMessageIds, prompt, provenance } };
}

export function conversationCopyContext(app: App, conversationId: string, refining: readonly string[] = []): (CopyContext & { active: boolean; blocksCopy: boolean; copyMessageId: string }) | undefined {
  const rows = app.db.query("SELECT request_json, user_message_id FROM agent_runs WHERE conversation_id = ? ORDER BY created_at, id").all(conversationId);
  for (const raw of rows) {
    const row = z.object({ request_json: z.string(), user_message_id: z.string() }).parse(raw);
    const parsed = z.object({ copyContext: CopyContextSchema }).safeParse(JSON.parse(row.request_json));
    if (parsed.success) {
      const context = { ...parsed.data.copyContext, sourceMessageIds: [...new Set([...parsed.data.copyContext.sourceMessageIds, row.user_message_id])] };
      const lineage = listConversationChangeSets(app.db, conversationId).filter((proposal) => proposal.decisionDraft?.sourceMessageIds.includes(row.user_message_id));
      const active = !lineage.some((proposal) => proposal.status === "applied");
      // Apply ends the task's instructions; an answer refining that task still cannot turn into another copy.
      const blocksCopy = active || lineage.some((proposal) => refining.includes(proposal.id));
      if (active) return { ...context, active, blocksCopy, copyMessageId: row.user_message_id };
      // Earlier contexts stored facts and control together. Keep their facts without reviving the old task's instructions.
      const start = context.prompt.indexOf("## Source setup and remembered decisions:");
      const end = context.prompt.lastIndexOf("\n\nTranslated seed (not applied or proposed):");
      const provenance = context.provenance ?? (start >= 0 && end > start ? context.prompt.slice(start, end) : "The earlier copy's source facts were not recorded separately.");
      return { ...context, active, blocksCopy, copyMessageId: row.user_message_id, prompt: `# Earlier copy provenance (read-only)\nThe earlier adaptation was applied. Follow BK's current request; these are historical source and target facts, not instructions to continue that task.\n\n${provenance}` };
    }
  }
  return undefined;
}

/** A source receipt remains the authority even when execution stopped before an outcome was stored. */
export function copyHandoff(app: App, runId: string): CopyHandoff | undefined {
  for (const raw of app.db.query("SELECT result_json FROM agent_effects WHERE run_id = ? ORDER BY rowid").all(runId)) {
    const row = z.object({ result_json: z.string() }).parse(raw);
    const parsed = z.object({ handoff: CopyHandoffSchema }).safeParse(JSON.parse(row.result_json));
    if (parsed.success) return parsed.data.handoff;
  }
  return undefined;
}
