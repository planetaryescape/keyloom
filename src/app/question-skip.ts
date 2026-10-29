// A question the agent asked to refine a proposal, and what happens to it when BK applies that proposal instead of answering (D-452).
// Its own file because applying (changes.ts) must resolve it and the conversation code (conversations.ts) imports changes.ts.
import { neutralBlock } from "../agent/blocks.ts";
import { ASK_USER } from "../agent/tools/ask-user.ts";
import type { ChangeSetRow } from "../persistence/change-sets.ts";
import { listPresentations } from "../persistence/chat-presentations.ts";
import { type MessageRow, insertMessage, listMessages } from "../persistence/conversations.ts";
import { resolvePresentedQuestion } from "./chat-presentation.ts";
import type { App } from "./context.ts";

/** The result stored for a question BK skipped by applying the proposal it refines; the card reads it as "Skipped". The next request shows it to the model too. */
export const SKIPPED_ANSWER = "BK applied the proposal without answering.";

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
 * Called inside the transaction that applies `cs`. A question refines the proposal saved earlier in its own turn, recorded with the pause
 * (`questionRefines`), and a question asked before anything was proposed refines nothing. Applying that proposal answers the question by
 * implication: the result is stored, so a reload, a later message and the model all see a skipped question and not an open or "answered
 * in his own words" one. (An apply that comes before the question is stored is handled when the paused turn is committed.)
 */
export function skipQuestionRefining(app: App, cs: ChangeSetRow): void {
  if (cs.conversationId === null || cs.source !== "agent") return;
  const open = openQuestion(listMessages(app.db, cs.conversationId));
  if (open === undefined) return;
  // Only the question recorded as refining this proposal. One that refines nothing, or another proposal, is not the apply's to answer.
  const recorded = listPresentations(app.db, cs.conversationId).find((p) => p.status === "waiting_user" && p.questionToolUseId === open.toolUseId);
  if (recorded?.questionRefines !== cs.id) return;
  insertMessage(app.db, { conversationId: cs.conversationId, role: "user", content: [{ type: "tool_result", tool_use_id: open.toolUseId, content: SKIPPED_ANSWER }] });
  resolvePresentedQuestion(app, cs.conversationId, open.toolUseId);
  // The run that paused on it is over, as when an answer arrives (storeMessage).
  app.db.query("UPDATE agent_runs SET status = 'completed', seq = seq + 1 WHERE conversation_id = ? AND status = 'waiting_user'").run(cs.conversationId);
}
