// What the chat panel shows, as a pure reducer over the stream's frames. Keeping it free of React
// and fetch lets the streaming rules (partial text, a dropped connection, superseded siblings) be
// tested directly.
import type { ChatEvent, ChatOutcome, ChatSelection, ConversationDetail, ProposalCard } from "../../api/http.ts";
import { toolActivity } from "./activity.ts";

export type UserTurn = { kind: "user"; id: string; text: string; selection: ChatSelection | null };
export type AssistantTurn = {
  kind: "assistant";
  id: string;
  text: string;
  /** The tool the agent is running right now, in words; cleared once text or a proposal follows. */
  activity: string | null;
  proposals: ProposalCard[];
  phase: "streaming" | "done" | "failed" | "stopped";
  failure: { code: string; message: string } | null;
  /** How the model ended the reply: anything but "complete" means the reply is incomplete. */
  ending: ChatOutcome["status"] | null;
};
export type Turn = UserTurn | AssistantTurn;
export type Transcript = { conversationId: string | null; turns: Turn[] };

export const EMPTY: Transcript = { conversationId: null, turns: [] };

export type Action =
  | { type: "sent"; userId: string; assistantId: string; text: string; selection: ChatSelection | null }
  | { type: "event"; event: ChatEvent }
  | { type: "failed"; code: string; message: string }
  | { type: "stopped" }
  | { type: "rolledBack" }
  | { type: "retry"; assistantId: string }
  | { type: "loaded"; detail: ConversationDetail }
  | { type: "applied"; changeSetId: string }
  | { type: "reset" };

const streamingAssistant = (assistantId: string): AssistantTurn => ({
  kind: "assistant", id: assistantId, text: "", activity: null, proposals: [], phase: "streaming", failure: null, ending: null,
});

function updateLast(state: Transcript, change: (turn: AssistantTurn) => AssistantTurn): Transcript {
  const index = state.turns.findLastIndex((turn) => turn.kind === "assistant");
  const turn = state.turns[index];
  if (turn === undefined || turn.kind !== "assistant") return state;
  return { ...state, turns: state.turns.with(index, change(turn)) };
}

function withProposal(proposals: readonly ProposalCard[], card: ProposalCard): ProposalCard[] {
  return proposals.some((p) => p.changeSetId === card.changeSetId) ? [...proposals] : [...proposals, card];
}

function onEvent(state: Transcript, event: ChatEvent): Transcript {
  switch (event.type) {
    case "start":
      return { ...state, conversationId: event.conversationId };
    case "text":
      return updateLast(state, (turn) => ({ ...turn, text: turn.text + event.delta, activity: null }));
    case "tool":
      return updateLast(state, (turn) => ({ ...turn, activity: toolActivity(event.name) }));
    case "proposal":
      return updateLast(state, (turn) => ({ ...turn, activity: null, proposals: withProposal(turn.proposals, event.proposal) }));
    case "done":
      return updateLast({ ...state, conversationId: event.outcome.conversationId }, (turn) => ({
        ...turn,
        // The streamed text is what the person watched; the outcome's is the fallback if none streamed.
        text: turn.text === "" ? event.outcome.text : turn.text,
        proposals: event.outcome.proposals.reduce(withProposal, turn.proposals),
        activity: null,
        phase: "done",
        ending: event.outcome.status,
      }));
    case "error":
      return updateLast(state, (turn) => ({ ...turn, activity: null, phase: "failed", failure: { code: event.code, message: event.message } }));
  }
}

export function transcriptReducer(state: Transcript, action: Action): Transcript {
  switch (action.type) {
    case "sent":
      return {
        ...state,
        turns: [
          ...state.turns,
          { kind: "user", id: action.userId, text: action.text, selection: action.selection },
          streamingAssistant(action.assistantId),
        ],
      };
    case "event":
      return onEvent(state, action.event);
    case "failed":
      return updateLast(state, (turn) => ({ ...turn, activity: null, phase: "failed", failure: { code: action.code, message: action.message } }));
    case "stopped":
      return updateLast(state, (turn) => (turn.phase === "streaming" ? { ...turn, activity: null, phase: "stopped" } : turn));
    case "rolledBack":
      // A refusal before the stream opened: the message never reached the agent, so it leaves no trace.
      return { ...state, turns: state.turns.slice(0, Math.max(0, state.turns.length - 2)) };
    case "retry": {
      const last = state.turns.at(-1);
      const kept = last?.kind === "assistant" ? state.turns.slice(0, -1) : state.turns;
      return { ...state, turns: [...kept, streamingAssistant(action.assistantId)] };
    }
    case "loaded":
      return fromConversation(action.detail);
    case "applied":
      return {
        ...state,
        turns: state.turns.map((turn) => {
          if (turn.kind !== "assistant" || !turn.proposals.some((p) => p.changeSetId === action.changeSetId)) return turn;
          return {
            ...turn,
            proposals: turn.proposals.map((p) =>
              p.changeSetId === action.changeSetId ? { ...p, status: "applied" as const } : p.status === "proposed" ? { ...p, status: "superseded" as const } : p,
            ),
          };
        }),
      };
    case "reset":
      return EMPTY;
  }
}

/** A stored conversation. Proposals aren't linked to a message, so they hang off the last reply. */
export function fromConversation(detail: ConversationDetail): Transcript {
  const turns: Turn[] = detail.messages.map((message) =>
    message.role === "user"
      ? { kind: "user", id: message.id, text: message.text, selection: message.selection }
      : { ...streamingAssistant(message.id), text: message.text, phase: "done", ending: "complete" },
  );
  const last = turns.findLastIndex((turn) => turn.kind === "assistant");
  const target = turns[last];
  if (target !== undefined && target.kind === "assistant") turns[last] = { ...target, proposals: detail.proposals };
  else if (detail.proposals.length > 0) turns.push({ ...streamingAssistant(`${detail.conversation.id}:proposals`), phase: "done", ending: "complete", proposals: detail.proposals });
  return { conversationId: detail.conversation.id, turns };
}

export const isStreaming = (state: Transcript): boolean => state.turns.some((turn) => turn.kind === "assistant" && turn.phase === "streaming");

export function lastUser(state: Transcript): UserTurn | undefined {
  return state.turns.findLast((turn): turn is UserTurn => turn.kind === "user");
}
