import type { ProposalCard } from "../../api/http.ts";
import type { RecoveryContext } from "../../validation/proposal-recovery.ts";
import type { AssistantTurn, Turn } from "./transcript.ts";

/** Never borrow the newest unrelated turn. Only the selected reply's owner or immediate optimistic request. */
export function owningRequest(turns: readonly Turn[], owner: AssistantTurn): string | undefined {
  const id = owner.userMessageId ?? owner.presentation?.userMessageId;
  const canonical = turns.find((turn) => turn.kind === "user" && turn.id === id);
  if (canonical?.kind === "user") return canonical.text;
  const at = turns.indexOf(owner);
  const preceding = turns[at - 1];
  if (preceding?.kind === "user" && preceding.id.startsWith("you-") && preceding.id !== id) return preceding.text;
  if (preceding?.kind === "assistant" && preceding.question?.answer) return `Answer to “${preceding.question.question}”: ${preceding.question.answer}`;
  return undefined;
}

export function proposalContext(proposal: ProposalCard, reasons: string[], turns: readonly Turn[]): RecoveryContext {
  const owner = turns.find((turn): turn is AssistantTurn => turn.kind === "assistant" && turn.proposals.some((p) => p.changeSetId === proposal.changeSetId));
  const original = owner ? owningRequest(turns, owner) : undefined;
  return { title: proposal.title, goal: original ?? proposal.decisionDraft?.goal ?? proposal.explanation, goalBasis: original ? "request" : proposal.decisionDraft?.goal ? "saved goal" : "explanation", reasons };
}
