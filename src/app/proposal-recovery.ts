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
  const stored = listMessages(app.db, conversationId);
  const shown = new Map(detail.messages.map((message) => [message.id, message]));
  const questions = new Map(detail.messages.flatMap((message) => message.question ? [[message.question.toolUseId, message] as const] : []));
  const questionOwners = new Map(detail.presentations.flatMap((presentation) => presentation.questionToolUseId ? [[presentation.questionToolUseId, presentation.userMessageId] as const] : []));
  const resolve = (id: string, before = stored.length): { id: string; text: string }[] => {
    const index = stored.findIndex((message) => message.id === id);
    const message = stored[index];
    if (!message || message.role !== "user" || index >= before) return [];
    const text = shown.get(id)?.text;
    if (text) return [{ id, text }];
    return message.content.map(neutralBlock).flatMap((block) => {
      if (block.type !== "tool_result") return [];
      const asked = questions.get(block.tool_use_id);
      if (!asked?.question?.answer) return [];
      // Older recordings may lack presentation ownership, but the actual question still anchors its preceding request.
      const askedIndex = stored.findIndex((candidate) => candidate.id === asked.id);
      if (askedIndex < 0 || askedIndex >= index) return [];
      const parent = questionOwners.get(block.tool_use_id) ?? stored.slice(0, askedIndex).findLast((candidate) => candidate.role === "user" && (shown.get(candidate.id)?.text || candidate.content.map(neutralBlock).some((part) => part.type === "tool_result" && questions.has(part.tool_use_id))))?.id;
      return [...(parent ? resolve(parent, askedIndex) : []), { id, text: `Answer to “${asked.question.question}”: ${asked.question.answer}` }];
    });
  };
  const lineage = stored.filter((message) => ids.has(message.id)).flatMap((message) => resolve(message.id));
  return [...new Map(lineage.map((part) => [part.id, part.text])).values()];
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
