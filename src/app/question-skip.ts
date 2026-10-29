// A question the agent asked to refine a proposal, and what happens to it when BK applies a proposal instead of answering it (D-452).
// Its own file because applying (changes.ts) must resolve it and the conversation code (conversations.ts) imports changes.ts.
import { neutralBlock } from "../agent/blocks.ts";
import { ASK_USER } from "../agent/tools/ask-user.ts";
import { type ChangeSetRow, listConversationChangeSets } from "../persistence/change-sets.ts";
import { listPresentations } from "../persistence/chat-presentations.ts";
import { type MessageRow, insertMessage, listMessages } from "../persistence/conversations.ts";
import { resolvePresentedQuestion } from "./chat-presentation.ts";
import type { App } from "./context.ts";

/** The result stored for a question BK skipped by applying the proposal it refines; the card reads it as "Skipped". The next request shows it to the model too. */
export const SKIPPED_ANSWER = "BK applied the proposal without answering.";

// The fixed opening of the Closed result. The title after it varies, so the card finds the result by this and not by the whole text.
const CLOSED_OPENING = "BK applied another proposal (";

/**
 * The result stored for a question closed because BK applied some other proposal of its conversation; the card reads it as "Closed". He decided
 * by acting, and the layout has changed since the question was asked, so the model is told the question is gone and may ask again.
 */
export const closedAnswer = (title: string | null): string =>
  `${CLOSED_OPENING}"${title ?? "a proposal"}") without answering. The layout has changed since you asked, so this question is closed; ask again if it still matters.`;

export const isClosedAnswer = (answer: string | null): boolean => answer !== null && answer.startsWith(CLOSED_OPENING);

/** The question a conversation is waiting on: an `ask_user` call in the stored messages with no result after it (D-382). */
export function openQuestion(messages: readonly MessageRow[]): { toolUseId: string } | undefined {
  const blocks = (m: MessageRow) => m.content.map(neutralBlock);
  const answered = new Set(messages.flatMap((m) => blocks(m).flatMap((b) => (b.type === "tool_result" ? [b.tool_use_id] : []))));
  for (const m of messages.toReversed()) {
    for (const b of blocks(m)) if (b.type === "tool_use" && b.name === ASK_USER && !answered.has(b.id)) return { toolUseId: b.id };
  }
  return undefined;
}

/**
 * Called inside the transaction that applies `cs`. Applying any agent proposal of a conversation closes its open question: BK decided by
 * acting, so a question left open would be one he has already settled with his hands. The result stored says
 * what happened. A question refines the proposal saved before it in its own turn, recorded with the pause (`questionRefines`), and applying
 * that one skips the question; any other apply closes it. The result is stored so a reload, a later message and the model all see an ended
 * question and not an open or "answered in his own words" one, and the run that paused on it is over, as when an answer arrives.
 * (An apply that comes before the question is stored is handled when the paused turn is committed: `closingResult`.)
 */
export function closeOpenQuestion(app: App, cs: ChangeSetRow): void {
  if (cs.conversationId === null || cs.source !== "agent") return;
  const open = openQuestion(listMessages(app.db, cs.conversationId));
  if (open === undefined) return;
  const recorded = listPresentations(app.db, cs.conversationId).find((p) => p.status === "waiting_user" && p.questionToolUseId === open.toolUseId);
  const content = recorded?.questionRefines === cs.id ? SKIPPED_ANSWER : closedAnswer(cs.title);
  insertMessage(app.db, { conversationId: cs.conversationId, role: "user", content: [{ type: "tool_result", tool_use_id: open.toolUseId, content }] });
  resolvePresentedQuestion(app, cs.conversationId, open.toolUseId);
  app.db.query("UPDATE agent_runs SET status = 'completed', seq = seq + 1 WHERE conversation_id = ? AND status = 'waiting_user'").run(cs.conversationId);
}

/** The agent proposals of a conversation that BK has applied. Taken when a turn starts, so the commit can tell what he applied while it ran. */
export const appliedProposalIds = (app: App, conversationId: string): Set<string> =>
  new Set(listConversationChangeSets(app.db, conversationId).filter((cs) => cs.source === "agent" && cs.status === "applied").map((cs) => cs.id));

/**
 * The result to store for a question a turn is about to pause on, when BK applied an agent proposal of the conversation while the turn was
 * running. It is the same ending as an apply after the question is stored: Skipped when one of them is the proposal the question refines,
 * Closed for any other. Undefined when none was applied, so the question waits. A proposal that was only rejected, or revised by a call in the
 * same reply, is not an apply: BK decided nothing by acting and the head did not move, so the question stays answerable.
 */
export function closingResult(app: App, conversationId: string, appliedAtStart: ReadonlySet<string>, refines: string | undefined): string | undefined {
  const applied = listConversationChangeSets(app.db, conversationId)
    .filter((cs) => cs.source === "agent" && cs.status === "applied" && !appliedAtStart.has(cs.id))
    .toSorted((a, b) => (a.decidedAt ?? 0) - (b.decidedAt ?? 0) || a.id.localeCompare(b.id));
  const latest = applied.at(-1);
  if (latest === undefined) return undefined;
  return applied.some((cs) => cs.id === refines) ? SKIPPED_ANSWER : closedAnswer(latest.title);
}
