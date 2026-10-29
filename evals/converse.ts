// What the live scenarios share for talking to the agent since D-452: the agent may stop to ask a refining question
// (`awaiting_answer`), so a scenario answers it with the recommended option and carries on until the turn completes.
// Not a scenario itself, so `bun test` doesn't collect it.
import { expect } from "bun:test";
import { type App, type ChatOutcome, type SendMessageInput, sendMessage } from "../src/app/index.ts";
import type { AgentModel } from "../src/agent/model.ts";
import { evalProvider } from "./provider.ts";

/** The prompt asks for at most three questions; a run that asks more has not converged. */
export const MAX_QUESTIONS = 3;
const GO_AHEAD = "Fine, go with your recommendation.";

export type Exchange = {
  outcomes: ChatOutcome[];
  conversationId: string;
  /** The questions the agent asked, in order. */
  questions: NonNullable<ChatOutcome["question"]>[];
};

/**
 * Sends `first`, answers each question with its recommended option (an option's ID where it has one, as the chat sends it) or, when
 * the scenario's point is what BK says, with `typedAnswer`, and
 * after a completed turn with nothing proposed yet sends the next of `nudges` (the last one repeats). Stops once a proposal exists
 * and the turn is complete, or after `maxTurns` turns. Throws when the last turn is still waiting for an answer; whether a completed
 * conversation proposed enough is for the caller's checks. `model` replaces the
 * provider's, for the scripted test of this loop.
 */
export async function converse(
  app: App,
  layoutId: string,
  first: Pick<SendMessageInput, "message" | "selection">,
  opts: { nudges: readonly string[]; maxTurns: number; typedAnswer?: string; model?: AgentModel; stop?: (outcomes: readonly ChatOutcome[]) => boolean },
): Promise<Exchange> {
  const outcomes: ChatOutcome[] = [];
  let conversationId: string | undefined;
  let nudged = 0;
  for (let turn = 0; turn < opts.maxTurns; turn++) {
    const waiting = outcomes.at(-1);
    let next: SendMessageInput;
    if (turn === 0) next = { ...first };
    else if (waiting?.status === "awaiting_answer" && waiting.question !== undefined) {
      const options = waiting.question.options;
      const pick = options.find((o) => o.recommended === true) ?? options[0];
      next = { answer: { toolUseId: waiting.question.toolUseId, text: opts.typedAnswer ?? (pick ? (pick.id ?? pick.label) : GO_AHEAD) } };
    } else next = { message: opts.nudges[Math.min(nudged++, opts.nudges.length - 1)] ?? GO_AHEAD };
    const input: SendMessageInput = { provider: evalProvider, ...next };
    if (opts.model) input.model = opts.model;
    if (conversationId) input.conversationId = conversationId;
    const outcome = await sendMessage(app, layoutId, input);
    conversationId = outcome.conversationId;
    outcomes.push(outcome);
    expect(["awaiting_answer", "complete"]).toContain(outcome.status);
    if (outcome.status === "complete" && (opts.stop ? opts.stop(outcomes) : outcomes.some((o) => o.proposals.length > 0))) break;
  }
  if (conversationId === undefined) throw new Error("converse needs at least one turn");
  // A question left open is not a finished evaluation, whatever the proposals say: fail the scenario rather than score half a conversation.
  if (outcomes.at(-1)?.status !== "complete") throw new Error(`the conversation was still ${outcomes.at(-1)?.status} after ${opts.maxTurns} turns; raise maxTurns or fix the scenario's answers`);
  return { outcomes, conversationId, questions: outcomes.flatMap((o) => (o.question === undefined ? [] : [o.question])) };
}

/** Everything the agent said in a turn, a question's words included, for checks on its reply and for the report. */
export function said(o: ChatOutcome): string {
  const q = o.question;
  if (q === undefined) return o.text;
  const options = q.options.map((opt) => `${opt.recommended ? "[recommended] " : ""}${opt.label}`).join(" | ");
  return `${o.text}\n\nQuestion: ${q.question}\nConsiderations: ${(q.considerations ?? []).join(" / ")}\nOptions: ${options}`;
}
