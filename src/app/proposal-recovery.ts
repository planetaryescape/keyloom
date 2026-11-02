import type { App } from "./context.ts";
import { getLayout } from "./layouts.ts";
import { checkChange } from "./changes.ts";
import { showConversation } from "./conversations.ts";
import { findChangeSet } from "../persistence/change-sets.ts";
import { listMessages } from "../persistence/conversations.ts";
import { neutralBlock } from "../agent/blocks.ts";
import { UsageError } from "./errors.ts";
import { proposalReview } from "../persistence/reviews.ts";
import { reviewFreshness } from "./review-freshness.ts";
import { declinedProposalCodes, formatProposalRecoveryRequest, refusalReasons, validationReasons, type RecoveryContext } from "../validation/proposal-recovery.ts";

export type ReplanSelector = { proposal?: string; conversation?: string; turn?: string };

function originalRequests(app: App, conversationId: string, ids: ReadonlySet<string>): string[] {
  const detail = showConversation(app, conversationId);
  return listMessages(app.db, conversationId).filter((message) => ids.has(message.id) && message.role === "user").flatMap((message) => {
    const text = detail.messages.find((shown) => shown.id === message.id)?.text;
    if (text) return [text];
    return message.content.map(neutralBlock).flatMap((block) => {
      if (block.type !== "tool_result") return [];
      const question = detail.messages.find((shown) => shown.question?.toolUseId === block.tool_use_id)?.question;
      return question?.answer ? [`Answer to “${question.question}”: ${question.answer}`] : [];
    });
  });
}

/** Read-only source resolution. All identity and recoverability checks precede starting agent work. */
export function proposalRecovery(app: App, ref: string, selector: ReplanSelector) {
  const view = getLayout(app, ref);
  const { proposal, conversation, turn } = selector;
  if (proposal ? conversation !== undefined || turn !== undefined : !conversation || !turn) throw new UsageError("Choose --proposal, or both --conversation and --turn; do not mix selectors.");
  let context: RecoveryContext;
  if (proposal) {
    const source = findChangeSet(app.db, proposal);
    if (!source || source.layoutId !== view.layout.id || source.status !== "proposed") throw new UsageError("Choose a proposed change belonging to this config.");
    const result = checkChange(app, ref, { baseRevisionId: source.baseRevisionId, ops: source.ops });
    const automatic = proposalReview(app.db, source.id);
    const retiredReview = automatic !== undefined && (automatic.review.runId !== automatic.runId || automatic.review.ai.status !== "done" || !reviewFreshness(app, automatic.review).current);
    if (result.ok && !retiredReview) throw new UsageError("This proposal still validates against the current layout; preview it normally.");
    if (source.conversationId && showConversation(app, source.conversationId).conversation.layoutId !== view.layout.id) throw new UsageError("The proposal's conversation belongs to another config.");
    const ids = new Set(source.decisionDraft?.sourceMessageIds ?? []);
    const lineage = source.conversationId ? originalRequests(app, source.conversationId, ids) : [];
    context = { title: source.title ?? "Saved proposal", goal: lineage.join("\n\n") || source.decisionDraft?.goal || source.explanation, goalBasis: lineage.length ? "request" : source.decisionDraft?.goal ? "saved goal" : "explanation", reasons: [...validationReasons(result.errors, view.document), ...(retiredReview ? ["The automatic recommendation is no longer current."] : [])] };
  } else {
    const detail = showConversation(app, conversation!);
    if (detail.conversation.layoutId !== view.layout.id) throw new UsageError("The conversation belongs to another config.");
    const presentation = detail.presentations.find((item) => item.userMessageId === turn);
    const codes = declinedProposalCodes(presentation);
    const lineage = originalRequests(app, detail.conversation.id, new Set([turn!]));
    if (!codes.length || !lineage.length) throw new UsageError("This turn has no complete recorded unsaved proposal validation refusal with an original request.");
    context = { title: "Refused proposal", goal: lineage.join("\n\n"), goalBasis: "request", reasons: refusalReasons(codes) };
  }
  return { version: 1 as const, layoutId: view.layout.id, headRevisionId: view.revision.id, context, request: formatProposalRecoveryRequest(context) };
}
