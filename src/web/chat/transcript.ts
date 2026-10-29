// What the chat panel shows, as a pure reducer over the stream's frames. Keeping it free of React
// and fetch lets the streaming rules (partial text, a dropped connection, superseded siblings) be
// tested directly.
import type { ChatAccounting, ChatMessage, ChatOutcome, ChatPresentation, ChatSelection, ConversationDetail, ObservedChatEvent, PriorityCard, ProposalCard, QuestionCard } from "../../api/http.ts";
import type { AgentArtifact } from "../../api/artifacts.ts";
import { toolActivity } from "./activity.ts";
import type { AgentRunSnapshot } from "../../api/agent-runs.ts";

export type ConfirmationCard = {
  planId: string;
  title: string;
  targets: string[];
  effects: string[];
  consequences: string[];
  status: "pending" | "approved" | "cancelled";
};

export type OutcomeCard = {
  saved: string;
  hardwareOutcome: "verified" | "offline" | "needs_manual_flash" | "unchanged" | "pending";
  device?: string;
};

export type UserTurn = { kind: "user"; id: string; text: string; selection: ChatSelection | null };
export type AssistantTurn = {
  kind: "assistant";
  id: string;
  /** Original server request owner; distinct from this turn's stable local React key. */
  userMessageId?: string;
  /** A replacement snapshot, not a log. Operation/public IDs are local to this request. */
  presentation?: ChatPresentation;
  /** Committed facts, separately identified from observer operations (effect_N is not op_N). */
  preparations?: AgentRunSnapshot["preparations"];
  /** This request's recorded usage; never borrowed from the conversation or another reply. */
  accounting?: ChatAccounting;
  text: string;
  /** The tool the agent is running right now, in words; cleared once text or a proposal follows. */
  activity: string | null;
  proposals: ProposalCard[];
  /** What BK said that keyloom remembered during this reply, as chips he can remove (08). */
  priorities: PriorityCard[];
  /** What the agent asked BK, open until he answers (D-381). */
  question: QuestionCard | null;
  /** Explicit confirmation card for plan approval (Rung 27). */
  confirmation?: ConfirmationCard | null;
  /** What was saved and what reached hardware (Rung 27). */
  outcome?: OutcomeCard | null;
  /** Typed domain artifacts (Rung 27). */
  artifacts?: AgentArtifact[];
  phase: "streaming" | "done" | "failed" | "stopped";
  failure: { code: string; message: string } | null;
  /** How the model ended the reply: anything but "complete" means the reply is incomplete. */
  ending: ChatOutcome["status"] | null;
};
export type Turn = UserTurn | AssistantTurn;

/**
 * Applying the proposal a question refines answers it by implication (D-452): the proposal was good enough, so the question closes as
 * skipped, which is derived and so holds after a reload. Old conversations asked before proposing, so they have no proposal in the turn.
 */
export const questionSkipped = (turn: AssistantTurn): boolean => turn.question?.answer === null && turn.proposals.some((p) => p.status === "applied");

/**
 * The open proposals the board should show: those of the newest reply that left any open, once the thread's last reply is done. Not the last
 * reply's own, because an answer that changes nothing proposes nothing, and the proposal on the board is still the one to pin (D-452).
 */
export function openProposalsOnBoard(turns: readonly Turn[]): ProposalCard[] {
  const last = turns.at(-1);
  if (last?.kind !== "assistant" || last.phase !== "done") return [];
  const open = (turn: Turn): turn is AssistantTurn => turn.kind === "assistant" && turn.phase === "done" && turn.proposals.some((p) => p.status === "proposed");
  const holder = turns.findLast(open);
  return holder === undefined ? [] : holder.proposals.filter((p) => p.status === "proposed");
}

/** The question is still waiting for BK. */
export const questionOpen = (turn: AssistantTurn): boolean => turn.question?.answer === null && !questionSkipped(turn);
/** The provider and model a conversation started on and stays on (D-111). Null before the first reply, and for one from before it was recorded. */
export type Pinned = { provider: ChatOutcome["provider"]; model: string | null };
export type Transcript = { conversationId: string | null; pinned: Pinned | null; turns: Turn[]; runSequences?: Record<string, number> };

export const EMPTY: Transcript = { conversationId: null, pinned: null, turns: [] };

export type Action =
  | { type: "sent"; userId: string; assistantId: string; text: string; selection: ChatSelection | null }
  | { type: "event"; event: ObservedChatEvent }
  | { type: "answering"; toolUseId: string; text: string; assistantId: string }
  | { type: "answerRejected"; toolUseId: string }
  | { type: "failed"; code: string; message: string }
  | { type: "stopped" }
  | { type: "rolledBack" }
  | { type: "retry"; assistantId: string }
  | { type: "loaded"; detail: ConversationDetail }
  | { type: "saved"; snapshot: AgentRunSnapshot; detail: ConversationDetail }
  | { type: "applied"; changeSetId: string }
  | { type: "priorityRemoved"; id: string }
  | { type: "reset" };

const streamingAssistant = (assistantId: string): AssistantTurn => ({
  kind: "assistant", id: assistantId, text: "", activity: null, proposals: [], priorities: [], question: null, phase: "streaming", failure: null, ending: null,
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

/**
 * A card that revises another sets that one aside (D-452). The stream sends only the new card, so the old one, which may sit in an earlier
 * reply, has to be marked here; the server already did, and a reload says the same.
 */
function supersede(turns: readonly Turn[], cards: readonly ProposalCard[]): Turn[] {
  const replaced = new Set(cards.flatMap((card) => (card.supersedes ? [card.supersedes] : [])));
  if (replaced.size === 0) return [...turns];
  return turns.map((turn) => turn.kind !== "assistant" || !turn.proposals.some((p) => replaced.has(p.changeSetId) && p.status === "proposed")
    ? turn
    : { ...turn, proposals: turn.proposals.map((p) => (replaced.has(p.changeSetId) && p.status === "proposed" ? { ...p, status: "superseded" as const } : p)) });
}

function withPriority(priorities: readonly PriorityCard[], card: PriorityCard): PriorityCard[] {
  return priorities.some((p) => p.id === card.id) ? [...priorities] : [...priorities, card];
}

/** Only explicitly classified answers enter the main reply; working notes stay in details. */
export function presentationAnswerText(presentation: ChatPresentation, messages: readonly ChatMessage[] = []): string {
  const canonical = new Map(messages.filter((message) => message.role === "assistant").map((message) => [message.id, message.text]));
  return presentation.messages.filter((message) => message.kind === "answer").map((message) =>
    message.messageId === undefined ? message.text : (canonical.get(message.messageId) ?? message.text),
  ).join("\n\n");
}

/** Losing the socket is not evidence of rollback, cancellation, or continued execution. */
export function interruptPresentation(presentation: ChatPresentation): ChatPresentation {
  if (presentation.status !== "running") return presentation;
  return {
    ...presentation,
    status: "unobserved",
    operations: presentation.operations.map((operation) => operation.status === "running" ? { ...operation, status: "unknown" } : operation),
    warning: "Live progress was interrupted. Work may still be running or may have stopped. Preparation may already have completed; inspect configs and proposals before retrying. Stop is not rollback. Reading history does not resend this request.",
  };
}

function presentedTurn(turn: AssistantTurn, presentation: ChatPresentation, messages: readonly ChatMessage[] = []): AssistantTurn {
  const question = turn.question;
  const answers = presentation.messages.filter((message) => message.kind === "answer");
  const previousAnswers = turn.presentation?.messages.filter((message) => message.kind === "answer") ?? [];
  // An identical replacement must not clip a full answer already recovered from done/history.
  const keepFullAnswer = turn.presentation?.status === "completed" && turn.phase === "done" && presentation.status === "completed"
    && answers.length === previousAnswers.length && answers.every((answer, index) => {
      const previous = previousAnswers[index];
      return previous?.id === answer.id && previous.text === answer.text && previous.messageId === answer.messageId;
    });
  return {
    ...turn, userMessageId: presentation.userMessageId, presentation,
    ...(presentation.accounting === undefined ? {} : { accounting: presentation.accounting }),
    text: keepFullAnswer ? turn.text : presentationAnswerText(presentation, messages), activity: null,
    // A terminal observation precedes done/error. Keep the current socket busy until that
    // transport frame arrives, so a second request cannot steal its outcome or question card.
    phase: turn.phase === "streaming" ? "streaming" : presentation.status === "failed" ? "failed" : presentation.status === "cancelled" ? "stopped" : presentation.status === "unobserved" ? turn.phase : "done",
    ending: presentation.status === "waiting_user" ? "awaiting_answer" : presentation.status === "completed" ? "complete" : null,
    question: question?.answer === null && presentation.status === "completed" && presentation.questionToolUseId === question.toolUseId ? { ...question, answer: "Answered" } : question,
  };
}

function interruptedTurn(turn: AssistantTurn, phase: "failed" | "stopped"): AssistantTurn {
  return {
    ...turn, activity: null, phase,
    ...(turn.presentation === undefined ? {} : { presentation: interruptPresentation(turn.presentation) }),
  };
}

function completedText(turn: AssistantTurn, outcome: ChatOutcome): string {
  if (turn.presentation === undefined) return turn.text === "" ? outcome.text : turn.text;
  // The outcome contains the uncapped last assistant message, not the concatenated legacy
  // deltas. Use it only when the observed grouping identifies that message as the final answer.
  return outcome.status === "complete" && turn.presentation.status === "completed" && turn.presentation.messages.some((message) => message.kind === "answer") ? outcome.text : turn.text;
}

function onEvent(state: Transcript, event: ObservedChatEvent): Transcript {
  switch (event.type) {
    case "start":
      return updateLast({ ...state, conversationId: event.conversationId }, (turn) => ({ ...turn, userMessageId: event.messageId }));
    case "presentation": {
      const index = state.turns.findIndex((turn) => turn.kind === "assistant" && turn.userMessageId === event.presentation.userMessageId);
      const turn = state.turns[index];
      if (turn?.kind !== "assistant") {
        // Never assign an older waiting snapshot to the current reply, even if its owner is not
        // in this local transcript (for example, history from a legacy server).
        const before = state.turns.findLastIndex((candidate) => candidate.kind === "assistant");
        return { ...state, turns: state.turns.toSpliced(before < 0 ? state.turns.length : before, 0, presentedTurn({ ...streamingAssistant(`${event.presentation.userMessageId}:reply`), phase: "done" }, event.presentation)) };
      }
      const presentation = (turn.phase === "failed" || turn.phase === "stopped") ? interruptPresentation(event.presentation) : event.presentation;
      return { ...state, turns: state.turns.with(index, presentedTurn(turn, presentation)) };
    }
    case "text":
      return updateLast(state, (turn) => turn.presentation === undefined ? { ...turn, text: turn.text + event.delta, activity: null } : turn);
    case "tool":
      return updateLast(state, (turn) => turn.presentation === undefined ? { ...turn, activity: toolActivity(event.name) } : turn);
    case "proposal": {
      const next = updateLast(state, (turn) => ({ ...turn, activity: null, proposals: withProposal(turn.proposals, event.proposal) }));
      return { ...next, turns: supersede(next.turns, [event.proposal]) };
    }
    case "priority":
      return updateLast(state, (turn) => ({ ...turn, priorities: withPriority(turn.priorities, event.priority) }));
    case "done": {
      const next = updateLast({ ...state, conversationId: event.outcome.conversationId, pinned: { provider: event.outcome.provider, model: event.outcome.model } }, (turn) => ({
        ...turn,
        text: completedText(turn, event.outcome),
        proposals: event.outcome.proposals.reduce(withProposal, turn.proposals),
        priorities: event.outcome.priorities.reduce(withPriority, turn.priorities),
        question: event.outcome.question ?? turn.question,
        activity: null,
        phase: "done",
        ending: event.outcome.status,
        accounting: {
          provider: event.outcome.provider, model: event.outcome.model, usage: event.outcome.usage,
          ...(event.outcome.costUsd === undefined ? {} : { costUsd: event.outcome.costUsd }),
        },
      }));
      return { ...next, turns: supersede(next.turns, event.outcome.proposals) };
    }
    case "error":
      return updateLast(state, (turn) => ({ ...interruptedTurn(turn, "failed"), failure: { code: event.code, message: event.message } }));
  }
}

export function transcriptReducer(state: Transcript, action: Action): Transcript {
  switch (action.type) {
    case "saved": {
      const { snapshot, detail } = action;
      if (snapshot.conversationId !== detail.conversation.id || snapshot.seq <= (state.runSequences?.[snapshot.id] ?? 0)) return state;
      const loaded = fromConversation(detail);
      const turns = loaded.turns.map((turn) => turn.kind === "assistant" && turn.userMessageId === snapshot.userMessageId && snapshot.presentation !== null
        ? { ...presentedTurn({ ...turn, phase: snapshot.status === "running" ? "streaming" : "done" }, snapshot.presentation, detail.messages), preparations: snapshot.preparations } : turn);
      return { ...loaded, turns, runSequences: { ...state.runSequences, [snapshot.id]: snapshot.seq } };
    }
    case "sent":
      return {
        ...state,
        turns: [
          // Typing instead of pressing a button still answers an open question (D-382).
          ...state.turns.map((turn) => (turn.kind === "assistant" && turn.question?.answer === null ? { ...turn, question: { ...turn.question, answer: "Answered in your own words" } } : turn)),
          { kind: "user", id: action.userId, text: action.text, selection: action.selection },
          streamingAssistant(action.assistantId),
        ],
      };
    case "event":
      return onEvent(state, action.event);
    case "answering":
      return {
        ...state,
        turns: [
          ...state.turns.map((turn) => (turn.kind === "assistant" && turn.question?.toolUseId === action.toolUseId ? { ...turn, question: { ...turn.question, answer: action.text } } : turn)),
          streamingAssistant(action.assistantId),
        ],
      };
    case "answerRejected":
      return {
        ...state,
        turns: state.turns.slice(0, -1).map((turn) => (turn.kind === "assistant" && turn.question?.toolUseId === action.toolUseId ? { ...turn, question: { ...turn.question, answer: null } } : turn)),
      };
    case "failed":
      return updateLast(state, (turn) => ({ ...interruptedTurn(turn, "failed"), failure: { code: action.code, message: action.message } }));
    case "stopped":
      return updateLast(state, (turn) => (turn.phase === "streaming" ? interruptedTurn(turn, "stopped") : turn));
    case "rolledBack":
      // A refusal before the stream opened: the message never reached the agent, so it leaves no trace.
      return { ...state, turns: state.turns.slice(0, Math.max(0, state.turns.length - 2)) };
    case "retry": {
      const last = state.turns.at(-1);
      const user = lastUser(state);
      // An explicit retry is a new request, not recovery of the observed one. Retain its facts.
      if (last?.kind === "assistant" && (last.presentation !== undefined || last.accounting !== undefined) && user !== undefined) {
        return { ...state, turns: [...state.turns, { ...user, id: `${action.assistantId}:user` }, streamingAssistant(action.assistantId)] };
      }
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
          // What the server sets aside is the rest of this proposal's group; a separate proposal beside it stays open (D-452).
          const group = turn.proposals.find((p) => p.changeSetId === action.changeSetId)?.proposalGroup ?? null;
          return {
            ...turn,
            proposals: turn.proposals.map((p) =>
              p.changeSetId === action.changeSetId ? { ...p, status: "applied" as const } : p.status === "proposed" && group !== null && p.proposalGroup === group ? { ...p, status: "superseded" as const } : p,
            ),
          };
        }),
      };
    case "priorityRemoved":
      return {
        ...state,
        turns: state.turns.map((turn) =>
          turn.kind === "assistant" ? { ...turn, priorities: turn.priorities.filter((p) => p.id !== action.id) } : turn,
        ),
      };
    case "reset":
      return EMPTY;
  }
}

/** Legacy history keeps its original ordering; observed requests group their public messages. */
export function fromConversation(detail: ConversationDetail): Transcript {
  if (detail.presentations?.length) return fromObservedConversation(detail);
  // An assistant turn that only called tools has no words to show; as a turn it would be an empty "keyloom" label.
  const spoken = detail.messages.filter((message) => message.role === "user" || message.text.trim() !== "" || message.question !== undefined);
  const turns: Turn[] = spoken.map((message) =>
    message.role === "user"
      ? { kind: "user", id: message.id, text: message.text, selection: message.selection }
      : { ...streamingAssistant(message.id), text: message.text, question: message.question ?? null, phase: "done", ending: message.question?.answer === null ? "awaiting_answer" : "complete" },
  );
  const last = turns.findLastIndex((turn) => turn.kind === "assistant");
  const target = turns[last];
  if (target !== undefined && target.kind === "assistant") turns[last] = { ...target, proposals: detail.proposals };
  else if (detail.proposals.length > 0) turns.push({ ...streamingAssistant(`${detail.conversation.id}:proposals`), phase: "done", ending: "complete", proposals: detail.proposals });
  // A chip sits under the first reply after the message it came from, where it appeared live.
  for (const card of detail.priorities) {
    if (!turns.some((turn) => turn.kind === "assistant")) {
      turns.push({ ...streamingAssistant(`${detail.conversation.id}:priorities`), phase: "done", ending: "complete" });
    }
    const from = turns.findIndex((turn) => turn.kind === "user" && card.sourceMessageIds.includes(turn.id));
    const after = from < 0 ? -1 : turns.findIndex((turn, i) => i > from && turn.kind === "assistant");
    const index = after >= 0 ? after : turns.findLastIndex((turn) => turn.kind === "assistant");
    const turn = turns[index];
    if (turn?.kind === "assistant") turns[index] = { ...turn, priorities: withPriority(turn.priorities, card) };
  }
  return { conversationId: detail.conversation.id, pinned: { provider: detail.conversation.provider, model: detail.conversation.model }, turns };
}

// Generated IDs share a monotonic ULID across prefixes (persistence/ids.ts). This lets hidden
// answer requests and turns with no canonical assistant text retain their real chronology.
const generatedOrder = (id: string): string | undefined => /^(?:msg|cs|dec)_[0-9A-HJKMNP-TV-Z]{26}$/.test(id) ? id.slice(id.indexOf("_") + 1) : undefined;

function fromObservedConversation(detail: ConversationDetail): Transcript {
  const presentations = new Map((detail.presentations ?? []).map((presentation) => [presentation.userMessageId, presentation]));
  const preparations = new Map((detail.preparationReceipts ?? []).map((receipt) => [receipt.userMessageId, receipt.preparations]));
  const requests = [...new Set([...detail.messages.filter((message) => message.role === "user").map((message) => message.id), ...presentations.keys()])];
  const orderedRequests = requests.every((id) => generatedOrder(id) !== undefined) ? requests.toSorted() : [];
  const ownerAt = (id: string): string | undefined => {
    const order = generatedOrder(id);
    return order === undefined ? undefined : orderedRequests.findLast((request) => (generatedOrder(request) ?? "") <= order);
  };
  const linked = new Map<string, string>();
  const questions = new Map<string, string>();
  for (const presentation of presentations.values()) {
    for (const message of presentation.messages) if (message.messageId !== undefined) linked.set(message.messageId, presentation.userMessageId);
    if (presentation.questionToolUseId !== undefined) questions.set(presentation.questionToolUseId, presentation.userMessageId);
  }
  const owned = new Map<string, ChatMessage[]>();
  const messageOwners = new Map<string, string>();
  let precedingRequest: string | undefined;
  for (const message of detail.messages) {
    if (message.role === "user") {
      precedingRequest = message.id;
      continue;
    }
    const owner = linked.get(message.id) ?? (message.question === undefined ? undefined : questions.get(message.question.toolUseId)) ?? ownerAt(message.id) ?? precedingRequest;
    if (owner !== undefined && presentations.has(owner)) {
      messageOwners.set(message.id, owner);
      const messages = owned.get(owner) ?? [];
      messages.push(message);
      owned.set(owner, messages);
    }
  }

  const entries: { order: string; turn: Turn }[] = [];
  const emitted = new Set<string>();
  const emit = (owner: string) => {
    const saved = presentations.get(owner);
    if (saved === undefined || emitted.has(owner)) return;
    // Loading a read-only history does not subscribe this browser to the running socket.
    const presentation = interruptPresentation(saved);
    emitted.add(owner);
    const messages = owned.get(owner) ?? [];
    const question = messages.find((message) => message.question !== undefined)?.question ?? null;
    entries.push({ order: owner, turn: { ...presentedTurn({ ...streamingAssistant(messages[0]?.id ?? `${owner}:reply`), phase: "done", question }, presentation, messages), preparations: preparations.get(owner) ?? [] } });
  };
  for (const message of detail.messages) {
    if (message.role === "user") {
      entries.push({ order: message.id, turn: { kind: "user", id: message.id, text: message.text, selection: message.selection } });
      emit(message.id);
    } else {
      const owner = messageOwners.get(message.id);
      if (owner !== undefined) emit(owner);
      else if (message.text.trim() !== "" || message.question !== undefined) entries.push({ order: message.id, turn: { ...streamingAssistant(message.id), text: message.text, question: message.question ?? null, phase: "done", ending: message.question?.answer === null ? "awaiting_answer" : "complete" } });
    }
  }
  for (const owner of presentations.keys()) emit(owner);
  // Do not lexically reorder synthetic or legacy-only fixtures. Real IDs give a reliable anchor
  // even when an answer's tool-result user message is intentionally absent from detail.messages.
  if (entries.every((entry) => generatedOrder(entry.order) !== undefined)) entries.sort((a, b) => a.order.localeCompare(b.order));
  const turns = entries.map((entry) => entry.turn);

  const lastAssistant = () => turns.findLastIndex((turn) => turn.kind === "assistant");
  const byOwner = (owner: string | undefined) => owner === undefined ? -1 : turns.findIndex((turn) => turn.kind === "assistant" && turn.userMessageId === owner);
  const byReference = (kind: "proposal" | "priority", id: string) => turns.findIndex((turn) => turn.kind === "assistant" && turn.presentation?.operations.some((operation) => operation.references.some((reference) => reference.kind === kind && reference.id === id)));
  const ensureAssistant = () => {
    if (lastAssistant() < 0) turns.push({ ...streamingAssistant(`${detail.conversation.id}:cards`), phase: "done", ending: "complete" });
    return lastAssistant();
  };
  for (const proposal of detail.proposals) {
    const referenced = byReference("proposal", proposal.changeSetId);
    const owner = byOwner(ownerAt(proposal.changeSetId));
    const index = referenced >= 0 ? referenced : owner >= 0 ? owner : ensureAssistant();
    const turn = turns[index];
    if (turn?.kind === "assistant") turns[index] = { ...turn, proposals: withProposal(turn.proposals, proposal) };
  }
  for (const priority of detail.priorities) {
    const owner = turns.findIndex((turn) => turn.kind === "assistant" && turn.userMessageId !== undefined && priority.sourceMessageIds.includes(turn.userMessageId));
    const referenced = byReference("priority", priority.id);
    const from = turns.findIndex((turn) => turn.kind === "user" && priority.sourceMessageIds.includes(turn.id));
    const after = from < 0 ? -1 : turns.findIndex((turn, index) => index > from && turn.kind === "assistant");
    const index = owner >= 0 ? owner : referenced >= 0 ? referenced : after >= 0 ? after : ensureAssistant();
    const turn = turns[index];
    if (turn?.kind === "assistant") turns[index] = { ...turn, priorities: withPriority(turn.priorities, priority) };
  }
  return { conversationId: detail.conversation.id, pinned: { provider: detail.conversation.provider, model: detail.conversation.model }, turns };
}

export const isStreaming = (state: Transcript): boolean => state.turns.some((turn) => turn.kind === "assistant" && turn.phase === "streaming");

export function lastUser(state: Transcript): UserTurn | undefined {
  return state.turns.findLast((turn): turn is UserTurn => turn.kind === "user");
}

/**
 * A thread carried back to the config it was about meets that config's own conversation, which the page finds again by itself. The
 * replies they share (by the request that started each) are dropped from the carried part, with the message that asked each, so
 * nothing shows twice.
 */
export function withoutRepeats(carried: readonly Turn[], own: readonly Turn[]): Turn[] {
  const shown = new Set(own.flatMap((turn) => (turn.kind === "assistant" && turn.userMessageId !== undefined ? [turn.userMessageId] : [])));
  const kept: Turn[] = [];
  for (const turn of carried) {
    if (turn.kind === "assistant" && turn.userMessageId !== undefined && shown.has(turn.userMessageId)) {
      if (kept.at(-1)?.kind === "user") kept.pop();
      continue;
    }
    kept.push(turn);
  }
  return kept;
}
