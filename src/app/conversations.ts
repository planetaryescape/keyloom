// Use cases for talking to the agent: send a message, list and show conversations (03, 10).
import { type AgentModel, type ContentBlock, type ModelMessage } from "../agent/model.ts";
import { neutralBlock } from "../agent/blocks.ts";
import type { ProviderId } from "../agent/provider.ts";
import { type AskedQuestion, AskUserSchema, ASK_USER } from "../agent/tools/ask-user.ts";
import { type TurnOutcome, type TurnStatus, runAgentTurn } from "../agent/run-turn.ts";
import { type Draft, typedText, userMessageText } from "../agent/prompt.ts";
import type { DecisionDraft } from "../layout/change.ts";
import type { Usage } from "../agent/model.ts";
import {
  type ConversationRow, type MessageRow, type Selection, findConversation, insertConversation, insertMessage, listConversations, listMessages,
} from "../persistence/conversations.ts";
import { type ChangeSetRow, listConversationChangeSets } from "../persistence/change-sets.ts";
import { type DecisionRow, type Subject, listConversationPriorities } from "../persistence/decisions.ts";
import { appendLog } from "../persistence/log.ts";
import { transact } from "../persistence/transaction.ts";
import type { ValidationResult } from "../validation/result.ts";
import { ValidationResultSchema } from "../validation/result.ts";
import { createAgentPorts } from "./agent-ports.ts";
import { type ProposalCard, toCard } from "./proposal-card.ts";
import { defaultAgentModel } from "./chat-model.ts";
import type { App } from "./context.ts";
import { BusyError, ModelError, NotFoundError, UsageError } from "./errors.ts";
import { getLayout } from "./layouts.ts";
import { selectLayers } from "./render.ts";
import { chatPresentation, unobservedPresentation, resolvePresentedQuestion, type Presentation } from "./chat-presentation.ts";
import { listPresentations } from "../persistence/chat-presentations.ts";
import { conversationAccounting, conversationPreparations, conversationRun } from "../persistence/agent-runs.ts";

export type { ProposalCard } from "./proposal-card.ts";

/** A priority BK stated, as the chat shows it: a chip with a remove button. */
export type PriorityCard = {
  id: string;
  priorityKind: NonNullable<DecisionRow["priorityKind"]>;
  statement: string;
  reason: string;
  subject: Subject;
  /** BK's messages it came from (08), so a reopened conversation can show the chip under the right reply. */
  sourceMessageIds: string[];
  createdAt: number;
};

export type ChatEvent =
  | { type: "presentation"; presentation: Presentation }
  | { type: "start"; conversationId: string; messageId: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string }
  | { type: "proposal"; proposal: ProposalCard }
  | { type: "priority"; priority: PriorityCard }
  | { type: "done"; outcome: ChatOutcome };

/** A question the agent asked BK, as the chat shows it: the options as buttons; `answer` is null while it is open (D-381). */
export type QuestionCard = {
  toolUseId: string;
  kind?: AskedQuestion["kind"];
  question: string;
  options: { id?: string; label: string; description?: string; recommended?: boolean }[];
  placeholder?: string;
  targetBoard?: string;
  targetLayer?: string;
  allowedPositions?: number[];
  allowedLayers?: string[];
  allowedKeyboards?: string[];
  allowOther: boolean;
  answer: string | null;
};

export type ChatOutcome = {
  conversationId: string;
  /** The IDs of the messages stored for this turn, BK's first. */
  messageIds: string[];
  status: TurnStatus;
  text: string;
  proposals: ProposalCard[];
  priorities: PriorityCard[];
  /** Set with the status `awaiting_answer`. */
  question?: QuestionCard;
  provider: ProviderId;
  model: string;
  effort: string;
  usage: Usage;
  /** What the provider charged, when it reports a figure. */
  costUsd?: number;
  iterations: number;
};

export type SendMessageInput = {
  presentationVersion?: 1;
  /** BK's words. Exactly one of this and `answer`. */
  message?: string;
  /** The answer to the question the conversation is waiting on; it becomes that tool call's result (D-382). */
  answer?: { toolUseId: string; text: string };
  conversationId?: string;
  /** `layer` is an ID, index or name, as for `layout show --layer`. */
  selection?: { layer: string; positions: number[] };
  /** Key changes drafted on the board and not applied (D-317); the agent is told of them with the message. */
  drafts?: Draft[];
  model?: AgentModel;
  /** `--provider`: which provider answers when `model` isn't given. */
  provider?: ProviderId;
  maxIterations?: number;
  onEvent?: (event: ChatEvent) => void;
  signal?: AbortSignal;
};

const TITLE_LENGTH = 60;

/** The first words of the first message, cut at a word, never mid-word (P3 review). */
export function conversationTitle(message: string): string {
  const text = message.trim().replace(/\s+/g, " ");
  if (text.length <= TITLE_LENGTH) return text;
  const cut = text.slice(0, TITLE_LENGTH + 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > TITLE_LENGTH / 2 ? cut.slice(0, space) : text.slice(0, TITLE_LENGTH)).replace(/[,;:.–-]+$/, "")}…`;
}

// Reserve the conversation before storing input, then identify the one message owning live work.
// A null reservation still excludes a second request, but cannot make an older projection live.
const answering = new Map<string, string | null>();


const cardOf = (q: AskedQuestion, toolUseId: string, answer: string | null): QuestionCard => {
  const card: QuestionCard = {
    toolUseId,
    question: q.question,
    options: (q.options ?? []).map((opt, i) => {
      const o: { id?: string; label: string; description?: string; recommended?: boolean } = {
        label: opt.label,
      };
      if (opt.id) o.id = opt.id;
      if (opt.description) o.description = opt.description;
      if (opt.recommended !== undefined) o.recommended = opt.recommended;
      else if (i === 0) o.recommended = true;
      return o;
    }),
    allowOther: q.allowOther === true,
    answer,
  };
  if (q.kind) card.kind = q.kind;
  if (q.placeholder) card.placeholder = q.placeholder;
  if (q.targetBoard) card.targetBoard = q.targetBoard;
  if (q.targetLayer) card.targetLayer = q.targetLayer;
  if (q.allowedPositions) card.allowedPositions = q.allowedPositions;
  if (q.allowedLayers) card.allowedLayers = q.allowedLayers;
  if (q.allowedKeyboards) card.allowedKeyboards = q.allowedKeyboards;
  return card;
};

/** The question a conversation is waiting on: an `ask_user` call in the stored messages with no result after it (D-382). */
export function openQuestion(messages: readonly MessageRow[]): { toolUseId: string } | undefined {
  const blocks = (m: MessageRow) => m.content.map(neutralBlock);
  const answered = new Set(messages.flatMap((m) => blocks(m).flatMap((b) => (b.type === "tool_result" ? [b.tool_use_id] : []))));
  for (const m of messages.toReversed()) {
    for (const b of blocks(m)) if (b.type === "tool_use" && b.name === ASK_USER && !answered.has(b.id)) return { toolUseId: b.id };
  }
  return undefined;
}

const toPriorityCard = (row: DecisionRow): PriorityCard => ({
  id: row.id,
  priorityKind: row.priorityKind ?? "pinned",
  statement: row.goal,
  reason: row.reason,
  subject: row.subject,
  sourceMessageIds: row.sourceMessageIds,
  createdAt: row.createdAt,
});

function resolveSelection(app: App, ref: string, input: SendMessageInput["selection"]): Selection | undefined {
  if (!input) return undefined;
  const view = getLayout(app, ref);
  const [layer] = selectLayers(view, input.layer);
  if (!layer) throw new NotFoundError(`no layer "${input.layer}"`);
  const positions = [...new Set(input.positions)].sort((a, b) => a - b);
  const bad = positions.find((p) => !Number.isInteger(p) || p < 0 || p >= view.board.definition.keyCount);
  if (bad !== undefined) throw new UsageError(`position ${bad} is not on ${view.board.definition.id} (0-${view.board.definition.keyCount - 1})`);
  if (positions.length === 0) throw new UsageError("a selection needs at least one position");
  return { layerId: layer.id, positions };
}

/** Drafts on keys that exist; a draft for a layer or position this layout doesn't have is a usage error, as a selection's is. */
function checkedDrafts(view: ReturnType<typeof getLayout>, drafts: SendMessageInput["drafts"]): Draft[] {
  for (const d of drafts ?? []) {
    if (!view.document.layers.some((l) => l.id === d.layerId)) throw new NotFoundError(`no layer "${d.layerId}"`);
    if (d.position >= view.board.definition.keyCount) throw new UsageError(`position ${d.position} is not on ${view.board.definition.id} (0-${view.board.definition.keyCount - 1})`);
  }
  return drafts ?? [];
}

function logTurn(app: App, base: Record<string, unknown>, started: number, extra: Record<string, unknown>): void {
  // IDs and numbers only: message text is already in the database (11#logs).
  appendLog(app.dataDir, { event: "agent_turn", ...base, durationMs: Date.now() - started, ...extra });
}

export async function messageModel(app: App, ref: string, input: SendMessageInput): Promise<AgentModel> {
  if ((input.message === undefined) === (input.answer === undefined)) throw new UsageError("send either a message or an answer to the open question");
  if (input.message !== undefined && !input.message.trim()) throw new UsageError("the message must not be empty");
  if (input.answer !== undefined && !input.answer.text.trim()) throw new UsageError("the answer must not be empty");
  if (input.answer !== undefined && input.conversationId === undefined) throw new UsageError("an answer belongs to a conversation");
  const view = getLayout(app, ref);
  // A conversation stays on the provider and model that started it (D-111); only a new one takes the flag or config.
  let existing: ConversationRow | undefined;
  if (input.conversationId !== undefined) {
    existing = findConversation(app.db, input.conversationId);
    if (!existing) throw new NotFoundError(`no conversation "${input.conversationId}"`);
    if (existing.layoutId !== view.layout.id) throw new UsageError(`conversation ${existing.id} belongs to another layout`);
    const wanted = input.model?.provider ?? input.provider;
    if (wanted !== undefined && wanted !== existing.provider) {
      throw new UsageError(`conversation ${existing.id} was started on ${existing.provider}, so it stays there; start a new conversation to use ${wanted}`);
    }
  }
  // Before anything is stored, so a missing key doesn't leave an empty conversation behind.
  return input.model ?? await defaultAgentModel(app.dataDir, existing ? { provider: existing.provider, ...(existing.model ? { model: existing.model } : {}) } : input.provider ? { provider: input.provider } : {});
}

/** Called inside the acceptance transaction, including question matching and conversation creation. */
export function storeMessage(app: App, ref: string, input: SendMessageInput, model: AgentModel) {
  const view = getLayout(app, ref);
  const selection = resolveSelection(app, ref, input.selection);
  const existing = input.conversationId === undefined ? undefined : findConversation(app.db, input.conversationId);
  if (input.conversationId !== undefined && (!existing || existing.layoutId !== view.layout.id)) throw new UsageError("conversation does not belong to this layout");
  const conversation = existing ?? insertConversation(app.db, { layoutId: view.layout.id, title: conversationTitle(input.message ?? ""), provider: model.provider, model: model.model });
  const waiting = conversationRun(app.db, conversation.id);
  if (answering.has(conversation.id) || waiting?.status === "running") throw new BusyError(`conversation ${conversation.id} is still answering the last message`);
  if (input.answer !== undefined && waiting?.status === "waiting_user" && waiting.revision_id !== view.revision.id) throw new UsageError("that question's target has changed");
  const open = openQuestion(listMessages(app.db, conversation.id));
  if (input.answer !== undefined && open?.toolUseId !== input.answer.toolUseId) throw new UsageError("that question is not open any more");
  // Typing instead of pressing an option still answers it: the API needs a result for every call before the next message.
  const results: ContentBlock[] = input.answer !== undefined
    ? [{ type: "tool_result", tool_use_id: input.answer.toolUseId, content: input.answer.text }]
    : open === undefined ? [] : [{ type: "tool_result", tool_use_id: open.toolUseId, content: "BK did not pick an option; he wrote his own message instead." }];
  const text = input.message === undefined ? undefined : userMessageText(input.message, selection, view.document, view.board, checkedDrafts(view, input.drafts));
  const userMessage = insertMessage(app.db, {
    conversationId: conversation.id, role: "user", content: [...results, ...(text === undefined ? [] : [{ type: "text" as const, text }])], ...(selection ? { selection } : {}),
  });
  const resolvedQuestions = open === undefined ? [] : resolvePresentedQuestion(app, conversation.id, open.toolUseId);
  if (open !== undefined) app.db.query("UPDATE agent_runs SET status = 'completed', seq = seq + 1 WHERE conversation_id = ? AND status = 'waiting_user'").run(conversation.id);
  return { view, selection, conversation, userMessage, resolvedQuestions, model };
}

export type PreparedMessage = ReturnType<typeof storeMessage>;

export async function sendMessage(app: App, ref: string, input: SendMessageInput): Promise<ChatOutcome> {
  const model = await messageModel(app, ref, input);
  const prepared = transact(app.db, () => storeMessage(app, ref, input, model));
  return runPreparedMessage(app, prepared, input);
}

export async function runPreparedMessage(app: App, prepared: PreparedMessage, input: SendMessageInput, runId?: string): Promise<ChatOutcome> {
  const { view, selection, conversation, userMessage, resolvedQuestions, model } = prepared;
  answering.set(conversation.id, userMessage.id);
  const started = Date.now();
  const logBase = { conversationId: conversation.id, provider: model.provider, model: model.model, effort: model.effort };
  try {
    input.onEvent?.({ type: "start", conversationId: conversation.id, messageId: userMessage.id });
    if (input.presentationVersion === 1) for (const resolved of resolvedQuestions) input.onEvent?.({ type: "presentation", presentation: resolved });
    const presentation = chatPresentation(app, conversation.id, userMessage.id, input.presentationVersion === 1 ? (value) => input.onEvent?.({ type: "presentation", presentation: value }) : undefined);

    const history: ModelMessage[] = listMessages(app.db, conversation.id).map((m) => ({ role: m.role, content: m.content.map(neutralBlock) }));
    let outcome: TurnOutcome;
    try {
      outcome = await runAgentTurn({
        model,
        ports: createAgentPorts(app, view.layout.id, conversation.id, [userMessage.id], selection, runId),
        history,
        ...(input.maxIterations === undefined ? {} : { maxIterations: input.maxIterations }),
        ...(input.signal ? { signal: input.signal } : {}),
        callbacks: {
          onObservation: (event) => presentation.observe(event),
          onText: (delta) => input.onEvent?.({ type: "text", delta }),
          onToolCall: (name) => input.onEvent?.({ type: "tool", name }),
          onProposal: (p) => {
            if (p.changeSetId === null) return;
            const row = listConversationChangeSets(app.db, conversation.id).find((c) => c.id === p.changeSetId);
            if (row) input.onEvent?.({ type: "proposal", proposal: toCard(row) });
          },
          onPriority: (p) => {
            const row = listConversationPriorities(app.db, conversation.id).find((d) => d.id === p.id);
            if (row) input.onEvent?.({ type: "priority", priority: toPriorityCard(row) });
          },
        },
      });
    } catch (err) {
      presentation.finish(input.signal?.aborted ? "cancelled" : "failed");
      const known = model.classifyError(err);
      logTurn(app, { ...logBase, messageIds: [userMessage.id] }, started, {
        status: "error", error: known?.kind ?? (err instanceof Error ? err.name : "unknown"),
      });
      if (known) throw new ModelError(known.kind, known.message);
      throw err;
    }

    return transact(app.db, () => {
      const stored = outcome.messages.map((m) => insertMessage(app.db, { conversationId: conversation.id, role: m.role, content: m.content }));
      presentation.finish(outcome.status === "awaiting_answer" ? "waiting_user" : outcome.status === "complete" ? "completed" : "incomplete", outcome.messages, stored, outcome.question?.toolUseId, {
        provider: model.provider, model: model.model, usage: outcome.usage,
        ...(outcome.costUsd === undefined ? {} : { costUsd: outcome.costUsd }),
      });
      const messageIds = [userMessage.id, ...stored.map((m) => m.id)];
      const ids = new Set(outcome.proposals.flatMap((p) => (p.changeSetId ? [p.changeSetId] : [])));
      const proposals = listConversationChangeSets(app.db, conversation.id).filter((c) => ids.has(c.id)).map(toCard);
      const priorityIds = new Set(outcome.priorities.map((p) => p.id));
      const priorities = listConversationPriorities(app.db, conversation.id).filter((d) => priorityIds.has(d.id)).map(toPriorityCard);

      logTurn(app, { ...logBase, messageIds }, started, {
        usage: outcome.usage,
        ...(outcome.costUsd === undefined ? {} : { costUsd: outcome.costUsd }),
        status: outcome.status,
        stopReason: outcome.stopReason,
        iterations: outcome.iterations,
        toolCalls: outcome.toolCalls,
        validationFailures: outcome.validationFailures,
        proposals: proposals.map((p) => p.changeSetId),
        priorities: priorities.map((p) => p.id),
      });

      const result: ChatOutcome = {
        conversationId: conversation.id, messageIds, status: outcome.status, text: outcome.text, proposals, priorities,
        provider: model.provider, model: model.model, effort: model.effort, usage: outcome.usage, iterations: outcome.iterations,
        ...(outcome.question === undefined ? {} : { question: cardOf(outcome.question, outcome.question.toolUseId, null) }),
        ...(outcome.costUsd === undefined ? {} : { costUsd: outcome.costUsd }),
      };
      if (runId !== undefined) app.db.query("UPDATE agent_runs SET status = ?, outcome_json = ?, finished_at = ?, seq = seq + 1 WHERE id = ?")
        .run(outcome.status === "awaiting_answer" ? "waiting_user" : outcome.status === "complete" ? "completed" : "failed", JSON.stringify(result), Date.now(), runId);
      input.onEvent?.({ type: "done", outcome: result });
      return result;
    });
  } finally {
    answering.delete(conversation.id);
  }
}

/** What came of a conversation, so the list can tell two about the same thing apart: the change applied, options left open, or talk. */
export type ConversationOutcome = { kind: "applied"; title: string } | { kind: "options"; count: number } | { kind: "talk" };

export function listConversationSummaries(app: App, ref: string): (ConversationRow & { outcome: ConversationOutcome })[] {
  return listConversations(app.db, getLayout(app, ref).layout.id).map((conversation) => {
    const sets = listConversationChangeSets(app.db, conversation.id);
    const applied = sets.findLast((cs) => cs.status === "applied");
    const open = sets.filter((cs) => cs.status === "proposed").length;
    const outcome: ConversationOutcome = applied !== undefined ? { kind: "applied", title: applied.title ?? "a change" } : open > 0 ? { kind: "options", count: open } : { kind: "talk" };
    return { ...conversation, outcome };
  });
}

export type DisplayMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Names of the tools an assistant message called. */
  toolCalls: string[];
  selection: Selection | null;
  createdAt: number;
  /** The question this reply asked, open or answered. */
  question?: QuestionCard;
};

export type ConversationView = { conversation: ConversationRow; messages: DisplayMessage[]; proposals: ProposalCard[]; priorities: PriorityCard[]; presentations: Presentation[]; preparationReceipts: ReturnType<typeof conversationPreparations> };

/** The conversation as the chat panel shows it: tool results are plumbing, so a message that is only results is left out. */
export function showConversation(app: App, id: string): ConversationView {
  const conversation = findConversation(app.db, id);
  if (!conversation) throw new NotFoundError(`no conversation "${id}"`);
  const messages: DisplayMessage[] = [];
  const stored = listMessages(app.db, id);
  const answers = new Map(stored.flatMap((m) => m.content.map(neutralBlock).flatMap((b) => (b.type === "tool_result" ? [[b.tool_use_id, b.content] as const] : []))));
  for (const m of stored) {
    const typed = m.content.flatMap((b) => (b.type === "text" && typeof b.text === "string" ? [b.text] : [])).join("");
    // The selection travels beside the message, so the bubble shows what BK typed, not the header the model was given.
    // A header is only stripped where one was put: a selection, or drafts (D-317); otherwise BK's own text could lose its first lines.
    const text = m.role === "user" && (m.selection || typed.startsWith("Unapplied draft on ")) ? typedText(typed) : typed;
    const toolCalls = m.content.flatMap((b) => (b.type === "tool_use" && typeof b.name === "string" ? [b.name] : []));
    if (text === "" && toolCalls.length === 0) continue;
    const asked = m.content.map(neutralBlock).find((b) => b.type === "tool_use" && b.name === ASK_USER);
    const parsed = asked?.type === "tool_use" ? AskUserSchema.safeParse(asked.input) : undefined;
    const question = asked?.type === "tool_use" && parsed?.success ? cardOf(parsed.data, asked.id, answers.get(asked.id) ?? null) : undefined;
    messages.push({ id: m.id, role: m.role, text, toolCalls, selection: m.selection, createdAt: m.createdAt, ...(question === undefined ? {} : { question }) });
  }
  const run = conversationRun(app.db, id);
  const accounting = conversationAccounting(app.db, id);
  return {
    conversation, messages, proposals: listConversationChangeSets(app.db, id).map(toCard),
    preparationReceipts: conversationPreparations(app.db, id),
    priorities: listConversationPriorities(app.db, id).map(toPriorityCard),
    presentations: listPresentations(app.db, id).map((presentation) => {
      const recorded = presentation.accounting ?? accounting.get(presentation.userMessageId);
      const metered = recorded === undefined ? presentation : { ...presentation, accounting: recorded };
      return metered.status === "running" && answering.get(id) !== metered.userMessageId && !(run?.user_message_id === metered.userMessageId && run.status === "running") ? unobservedPresentation(metered) : metered;
    }),
  };
}
