// Use cases for talking to the agent: send a message, list and show conversations (03, 10).
import { type AgentModel, type ModelMessage } from "../agent/model.ts";
import type { ProviderId } from "../agent/provider.ts";
import { type TurnOutcome, type TurnStatus, runAgentTurn } from "../agent/run-turn.ts";
import { typedText, userMessageText } from "../agent/prompt.ts";
import type { DecisionDraft } from "../layout/change.ts";
import type { Usage } from "../agent/model.ts";
import {
  type ConversationRow, type Selection, findConversation, insertConversation, insertMessage, listConversations, listMessages,
} from "../persistence/conversations.ts";
import { type ChangeSetRow, listConversationChangeSets } from "../persistence/change-sets.ts";
import { type DecisionRow, type Subject, listConversationPriorities } from "../persistence/decisions.ts";
import { appendLog } from "../persistence/log.ts";
import { transact } from "../persistence/transaction.ts";
import type { ValidationResult } from "../validation/result.ts";
import { ValidationResultSchema } from "../validation/result.ts";
import { createAgentPorts } from "./agent-ports.ts";
import { defaultAgentModel } from "./chat-model.ts";
import type { App } from "./context.ts";
import { BusyError, ModelError, NotFoundError, UsageError } from "./errors.ts";
import { getLayout } from "./layouts.ts";
import { selectLayers } from "./render.ts";

export type ProposalCard = {
  changeSetId: string;
  /** Alternatives from one `propose_changes` call share a group (03). */
  proposalGroup: string | null;
  title: string;
  explanation: string;
  tradeoffs: { gains: string[]; costs: string[] };
  /** What will be remembered if BK applies this (08); null for a change set that carries no reason. */
  decisionDraft: DecisionDraft | null;
  status: ChangeSetRow["status"];
  validation: ValidationResult;
  ops: ChangeSetRow["ops"];
};

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
  | { type: "start"; conversationId: string; messageId: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string }
  | { type: "proposal"; proposal: ProposalCard }
  | { type: "priority"; priority: PriorityCard }
  | { type: "done"; outcome: ChatOutcome };

export type ChatOutcome = {
  conversationId: string;
  /** The IDs of the messages stored for this turn, BK's first. */
  messageIds: string[];
  status: TurnStatus;
  text: string;
  proposals: ProposalCard[];
  priorities: PriorityCard[];
  provider: ProviderId;
  model: string;
  effort: string;
  usage: Usage;
  /** What the provider charged, when it reports a figure. */
  costUsd?: number;
  iterations: number;
};

export type SendMessageInput = {
  message: string;
  conversationId?: string;
  /** `layer` is an ID, index or name, as for `layout show --layer`. */
  selection?: { layer: string; positions: number[] };
  model?: AgentModel;
  /** `--provider`: which provider answers when `model` isn't given. */
  provider?: ProviderId;
  maxIterations?: number;
  onEvent?: (event: ChatEvent) => void;
  signal?: AbortSignal;
};

const TITLE_LENGTH = 60;

// A second message into a conversation that is mid-turn would interleave tool results with it.
const answering = new Set<string>();

const toCard = (row: ChangeSetRow): ProposalCard => ({
  changeSetId: row.id,
  proposalGroup: row.proposalGroup,
  title: row.title ?? row.explanation.slice(0, 80),
  explanation: row.explanation,
  tradeoffs: row.tradeoffs,
  decisionDraft: row.decisionDraft === null ? null : { goal: row.decisionDraft.goal, choice: row.decisionDraft.choice, reason: row.decisionDraft.reason, scope: row.decisionDraft.scope },
  status: row.status,
  validation: ValidationResultSchema.parse(row.validation),
  ops: row.ops,
});

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

function logTurn(app: App, base: Record<string, unknown>, started: number, extra: Record<string, unknown>): void {
  // IDs and numbers only: message text is already in the database (11#logs).
  appendLog(app.dataDir, { event: "agent_turn", ...base, durationMs: Date.now() - started, ...extra });
}

export async function sendMessage(app: App, ref: string, input: SendMessageInput): Promise<ChatOutcome> {
  if (!input.message.trim()) throw new UsageError("the message must not be empty");
  const view = getLayout(app, ref);
  const selection = resolveSelection(app, ref, input.selection);
  // Before anything is stored, so a missing key doesn't leave an empty conversation behind.
  const model = input.model ?? defaultAgentModel(app.dataDir, input.provider ? { provider: input.provider } : {});

  let conversation: ConversationRow;
  if (input.conversationId === undefined) {
    conversation = insertConversation(app.db, { layoutId: view.layout.id, title: input.message.trim().replace(/\s+/g, " ").slice(0, TITLE_LENGTH) });
  } else {
    const found = findConversation(app.db, input.conversationId);
    if (!found) throw new NotFoundError(`no conversation "${input.conversationId}"`);
    if (found.layoutId !== view.layout.id) throw new UsageError(`conversation ${found.id} belongs to another layout`);
    conversation = found;
  }
  if (answering.has(conversation.id)) throw new BusyError(`conversation ${conversation.id} is still answering the last message`);
  answering.add(conversation.id);

  const started = Date.now();
  const logBase = { conversationId: conversation.id, provider: model.provider, model: model.model, effort: model.effort };
  try {
    const text = userMessageText(input.message, selection, view.document);
    const userMessage = insertMessage(app.db, {
      conversationId: conversation.id, role: "user", content: [{ type: "text", text }], ...(selection ? { selection } : {}),
    });
    input.onEvent?.({ type: "start", conversationId: conversation.id, messageId: userMessage.id });

    const history: ModelMessage[] = listMessages(app.db, conversation.id).map((m) => ({ role: m.role, content: m.content }));
    let outcome: TurnOutcome;
    try {
      outcome = await runAgentTurn({
        model,
        ports: createAgentPorts(app, view.layout.id, conversation.id, [userMessage.id], selection),
        history,
        ...(input.maxIterations === undefined ? {} : { maxIterations: input.maxIterations }),
        ...(input.signal ? { signal: input.signal } : {}),
        callbacks: {
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
      const known = model.classifyError(err);
      logTurn(app, { ...logBase, messageIds: [userMessage.id] }, started, {
        status: "error", error: known?.kind ?? (err instanceof Error ? err.name : "unknown"),
      });
      if (known) throw new ModelError(known.kind, known.message);
      throw err;
    }

    const stored = transact(app.db, () => outcome.messages.map((m) => insertMessage(app.db, { conversationId: conversation.id, role: m.role, content: m.content })));
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
      ...(outcome.costUsd === undefined ? {} : { costUsd: outcome.costUsd }),
    };
    input.onEvent?.({ type: "done", outcome: result });
    return result;
  } finally {
    answering.delete(conversation.id);
  }
}

export function listConversationSummaries(app: App, ref: string): ConversationRow[] {
  return listConversations(app.db, getLayout(app, ref).layout.id);
}

export type DisplayMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Names of the tools an assistant message called. */
  toolCalls: string[];
  selection: Selection | null;
  createdAt: number;
};

export type ConversationView = { conversation: ConversationRow; messages: DisplayMessage[]; proposals: ProposalCard[]; priorities: PriorityCard[] };

/** The conversation as the chat panel shows it: tool results are plumbing, so a message that is only results is left out. */
export function showConversation(app: App, id: string): ConversationView {
  const conversation = findConversation(app.db, id);
  if (!conversation) throw new NotFoundError(`no conversation "${id}"`);
  const messages: DisplayMessage[] = [];
  for (const m of listMessages(app.db, id)) {
    const stored = m.content.flatMap((b) => (b.type === "text" && typeof b.text === "string" ? [b.text] : [])).join("");
    // The selection travels beside the message, so the bubble shows what BK typed, not the header the model was given.
    const text = m.role === "user" && m.selection ? typedText(stored) : stored;
    const toolCalls = m.content.flatMap((b) => (b.type === "tool_use" && typeof b.name === "string" ? [b.name] : []));
    if (text === "" && toolCalls.length === 0) continue;
    messages.push({ id: m.id, role: m.role, text, toolCalls, selection: m.selection, createdAt: m.createdAt });
  }
  return {
    conversation, messages, proposals: listConversationChangeSets(app.db, id).map(toCard),
    priorities: listConversationPriorities(app.db, id).map(toPriorityCard),
  };
}
