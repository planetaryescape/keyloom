// A scripted ChatBackend for the dev harness and the server tests. It plays the Option-Option story
// from the rung 3 brief: every message gets three proposals at once, with its assumption in one line. Streaming is word by word with a delay, so the panel can be seen (and screenshotted)
// mid-reply. Proposals are validated by the real validator and stored in the FakeEditor, so
// applying one goes through POST /api/change-sets/:id/apply like the real thing.
import type {
  ChatEvent, ChatOutcome, ChatProviderStatus, ChatRequest, ConversationDetail, ConversationSummary, ChatMessage, ProposalCard, QuestionCard,
} from "../../src/api/http.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { ChatError, type ChatBackend } from "../../src/server/chat-backend.ts";
import { evaluate } from "../../src/validation/validate.ts";
import type { FakeEditor, StoredProposal } from "./fake-editor-backend.ts";

export interface FakeChatOptions {
  /** Delay between streamed words. */
  tokenDelayMs?: number;
  /** Pause around each tool call and proposal. */
  stepMs?: number;
  /** Answer 503 missing_api_key before the stream opens. */
  missingKey?: boolean;
  /** Drop the model connection part-way through the reply. */
  failMidStream?: boolean;
  /** Answer 409 busy before the stream opens. */
  busy?: boolean;
}

// Nothing is asked first: every reply acts on the obvious default and says what it assumed, in one line (D-380).
const PROPOSAL_INTRO = [
  "Here are three ways to get **Option, Option** without fighting the home-row mod on `S`.",
  "Each one is checked against your current layout, and none of them touches the home row:",
  "- A macro on a free key sends both presses for you.",
  "- A plain Option on the `Nav` layer keeps it under your hand, one layer away.",
  "- A plain Option on an empty base key is the simplest, but it uses a key you may want later.",
  "I assumed you hold `Nav` with your right thumb; say if it is the left and I'll redo the second one.",
  "Hover a card to see it on the keyboard, then apply the one you like.",
].join("\n\n");

const MACRO_ID = "option-option";
const OPTION: ChangeOp = { op: "setBinding", at: { layerId: "nav", position: 32 }, binding: { kind: "modifier", mods: ["LALT"] } };

const ALTERNATIVES: readonly {
  title: string;
  explanation: string;
  tradeoffs: ProposalCard["tradeoffs"];
  ops: ChangeOp[];
}[] = [
  {
    title: "Option, Option macro on a free key",
    explanation: "A macro on the empty key 65 taps Option, waits a moment, and taps it again, so one press does what the double-tap does.",
    tradeoffs: {
      gains: ["Option, Option in one press", "Nothing you use today moves"],
      costs: ["Apps that need to see two separate key presses may ignore a fast macro", "Uses one of your few empty keys"],
    },
    ops: [
      { op: "upsertMacro", macro: { id: MACRO_ID, name: "Option, Option", steps: [{ op: "tap", mods: ["LALT"] }, { op: "waitMs", ms: 60 }, { op: "tap", mods: ["LALT"] }] } },
      { op: "setBinding", at: { layerId: "base", position: 64 }, binding: { kind: "macro", macroId: MACRO_ID } },
    ],
  },
  {
    title: "Plain Option on the Nav layer",
    explanation: "While you hold Nav, S becomes a plain Option key with no hold behaviour, so you can tap it twice.",
    tradeoffs: {
      gains: ["A real key you can tap and hold as you like", "Home row stays as it is"],
      costs: ["Two-handed: hold Nav, then tap S twice"],
    },
    ops: [OPTION],
  },
  {
    title: "Plain Option on an empty base key",
    explanation: "Key 58 on the base layer is empty. Making it a plain Option gives you a dedicated key.",
    tradeoffs: {
      gains: ["One key, no layers, no timing", "Works in every app"],
      costs: ["Spends an empty base key", "Further from the home row than S"],
    },
    ops: [{ op: "setBinding", at: { layerId: "base", position: 57 }, binding: { kind: "modifier", mods: ["LALT"] } }],
  },
];

type Conversation = { summary: ConversationSummary; messages: ChatMessage[]; proposals: { id: string; card: ProposalCard }[]; layoutId: string };

export class FakeChat implements ChatBackend {
  private readonly conversations = new Map<string, Conversation>();
  private counter = 0;
  private readonly options: Required<FakeChatOptions>;

  constructor(
    private readonly editor: FakeEditor,
    private readonly layoutId = "moonlander-daily",
    options: FakeChatOptions = {},
  ) {
    this.options = { tokenDelayMs: 35, stepMs: 400, missingKey: false, failMidStream: false, busy: false, ...options };
  }

  async provider(): Promise<ChatProviderStatus> {
    const providers: ChatProviderStatus["providers"] = [
      { id: "anthropic", label: "Anthropic API key", defaultModel: "claude-opus-5-5", ready: false, setup: "Start keyloom with ANTHROPIC_API_KEY set.", command: "ANTHROPIC_API_KEY=<your key> keyloom serve" },
      { id: "openrouter", label: "OpenRouter API key", defaultModel: "anthropic/claude-opus-5.5", ready: !this.options.missingKey, setup: "Start keyloom with OPENROUTER_API_KEY set.", command: "OPENROUTER_API_KEY=<your key> keyloom serve" },
      { id: "codex", label: "Codex (ChatGPT login)", defaultModel: "gpt-6.1-sol", ready: false, setup: "Sign in once with the Codex CLI, then start keyloom.", command: "codex login" },
    ];
    return { active: this.options.missingKey ? null : { provider: this.chosen.provider, model: this.chosen.model, effort: "medium" }, lockedBy: null, providers };
  }

  private chosen: { provider: "anthropic" | "openrouter" | "codex"; model: string } = { provider: "openrouter", model: "anthropic/claude-opus-5.5" };

  async chooseProvider(choice: { provider: "anthropic" | "openrouter" | "codex"; model?: string | undefined }): Promise<ChatProviderStatus> {
    this.chosen = { provider: choice.provider, model: choice.model ?? { anthropic: "claude-opus-5-5", openrouter: "anthropic/claude-opus-5.5", codex: "gpt-6.1-sol" }[choice.provider] };
    return this.provider();
  }

  async list(ref: string): Promise<ConversationSummary[] | null> {
    if (ref !== this.layoutId) return null;
    return [...this.conversations.values()].map((c) => c.summary).sort((a, b) => b.createdAt - a.createdAt);
  }

  async get(id: string): Promise<ConversationDetail | null> {
    const found = this.conversations.get(id);
    if (found === undefined) return null;
    return {
      conversation: { ...found.summary, layoutId: found.layoutId, provider: "openrouter", model: "anthropic/claude-opus-5.5" },
      messages: found.messages,
      proposals: found.proposals.map(({ id: changeSetId, card }) => ({ ...card, status: this.editor.proposalStatus(changeSetId) ?? card.status })),
      priorities: [],
    };
  }

  async retirePriority(): Promise<boolean> {
    return false;
  }

  async send(ref: string, request: ChatRequest, emit: (event: ChatEvent) => void, signal: AbortSignal): Promise<void> {
    if (ref !== this.layoutId) throw new ChatError(404, "not_found", `no layout "${ref}"`);
    if (this.options.missingKey) {
      throw new ChatError(503, "missing_api_key", "ANTHROPIC_API_KEY is not set. Start keyloom with it set to use the chat.");
    }
    if (this.options.busy) throw new ChatError(409, "busy", "This conversation is still answering the last message.");

    const conversation = request.conversationId === undefined ? this.open(request.message ?? "") : this.conversations.get(request.conversationId);
    if (conversation === undefined) throw new ChatError(404, "not_found", `no conversation "${request.conversationId}"`);
    const now = Date.now();
    const messageId = `msg_${++this.counter}`;
    if (request.answer !== undefined) return this.answered(conversation, request.answer, messageId, emit, signal);
    const message = request.message ?? "";
    conversation.messages.push({ id: `msg_${++this.counter}`, role: "user", text: message, toolCalls: [], selection: request.selection ?? null, createdAt: now });
    // Only a request that leaves the person's real choice open gets a question; "replace" is already a choice, so it is acted on (D-380).
    if (/move my setup/i.test(message)) return this.ask(conversation, messageId, emit, signal);
    emit({ type: "start", conversationId: conversation.summary.id, messageId });

    const toolCalls: string[] = [];
    const tool = async (name: string) => {
      toolCalls.push(name);
      emit({ type: "tool", name });
      await this.pause(this.options.stepMs, signal);
    };

    await this.pause(this.options.stepMs, signal);
    await tool("get_layout");
    let text = "";
    const stream = async (reply: string, stopAfter?: number) => {
      const words = reply.match(/\S+\s*/g) ?? [];
      for (const [index, word] of words.entries()) {
        if (signal.aborted) return;
        if (stopAfter !== undefined && index >= stopAfter) return;
        text += word;
        emit({ type: "text", delta: word });
        await this.pause(this.options.tokenDelayMs, signal);
      }
    };

    if (this.options.failMidStream) {
      await stream(PROPOSAL_INTRO, 14);
      throw new ChatError(502, "model_connection", "The connection to the model dropped before the reply finished.");
    }

    const cards: ProposalCard[] = [];
    {
      await stream(PROPOSAL_INTRO);
      if (!signal.aborted) {
        await tool("propose_changes");
        const group = `grp_${++this.counter}`;
        for (const alternative of ALTERNATIVES) {
          const stored = this.editor.storeProposal(alternative.ops, alternative.explanation, group);
          const card = this.card(stored, alternative, group);
          cards.push(card);
          conversation.proposals.push({ id: stored.id, card });
          emit({ type: "proposal", proposal: card });
          await this.pause(this.options.stepMs / 2, signal);
        }
      }
    }
    if (signal.aborted) return;

    conversation.messages.push({ id: messageId, role: "assistant", text, toolCalls, selection: null, createdAt: Date.now() });
    const outcome: ChatOutcome = {
      conversationId: conversation.summary.id,
      messageIds: [messageId],
      status: "complete",
      text,
      proposals: cards,
      priorities: [],
      provider: "openrouter",
      model: "anthropic/claude-opus-5.5",
      effort: "medium",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      iterations: 1,
    };
    emit({ type: "done", outcome });
  }

  private async ask(conversation: Conversation, messageId: string, emit: (event: ChatEvent) => void, signal: AbortSignal): Promise<void> {
    emit({ type: "start", conversationId: conversation.summary.id, messageId });
    emit({ type: "tool", name: "ask_user" });
    await this.pause(this.options.stepMs, signal);
    const question: QuestionCard = {
      toolUseId: `toolu_${++this.counter}`, question: "Replace the config on your keyboard, or add this one beside it?",
      options: [{ label: "Add it as a new config", description: "Your current config stays on the keyboard until you switch." }, { label: "Replace the current config", description: "The old one stays in History and can be restored." }],
      allowOther: true, answer: null,
    };
    conversation.messages.push({ id: messageId, role: "assistant", text: "", toolCalls: ["ask_user"], selection: null, createdAt: Date.now(), question });
    emit({ type: "done", outcome: this.outcome(conversation, messageId, "awaiting_answer", "", [], question) });
  }

  private async answered(conversation: Conversation, answer: { toolUseId: string; text: string }, messageId: string, emit: (event: ChatEvent) => void, signal: AbortSignal): Promise<void> {
    const asked = conversation.messages.find((m) => m.question?.toolUseId === answer.toolUseId);
    if (asked?.question === undefined || asked.question.answer !== null) throw new ChatError(400, "usage", "that question is not open any more");
    asked.question = { ...asked.question, answer: answer.text };
    emit({ type: "start", conversationId: conversation.summary.id, messageId });
    const reply = `Done: I went with "${answer.text}". Nothing is applied until you say so.`;
    for (const word of reply.match(/\S+\s*/g) ?? []) {
      if (signal.aborted) return;
      emit({ type: "text", delta: word });
      await this.pause(this.options.tokenDelayMs, signal);
    }
    conversation.messages.push({ id: messageId, role: "assistant", text: reply, toolCalls: [], selection: null, createdAt: Date.now() });
    emit({ type: "done", outcome: this.outcome(conversation, messageId, "complete", reply, []) });
  }

  private outcome(conversation: Conversation, messageId: string, status: ChatOutcome["status"], text: string, proposals: ProposalCard[], question?: QuestionCard): ChatOutcome {
    return {
      conversationId: conversation.summary.id, messageIds: [messageId], status, text, proposals, priorities: [],
      provider: "openrouter", model: "anthropic/claude-opus-5.5", effort: "medium",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }, iterations: 1,
      ...(question === undefined ? {} : { question }),
    };
  }

  private open(firstMessage: string): Conversation {
    const id = `conv_${++this.counter}`;
    const conversation: Conversation = {
      summary: { id, title: firstMessage.length > 60 ? `${firstMessage.slice(0, 57)}...` : firstMessage, createdAt: Date.now() },
      messages: [],
      proposals: [],
      layoutId: this.layoutId,
    };
    this.conversations.set(id, conversation);
    return conversation;
  }

  private card(stored: StoredProposal, alternative: (typeof ALTERNATIVES)[number], group: string | null): ProposalCard {
    const { board, document } = this.editor.detail();
    const evaluation = evaluate(board, document, stored.ops);
    return {
      changeSetId: stored.id,
      proposalGroup: group,
      title: alternative.title,
      explanation: alternative.explanation,
      tradeoffs: alternative.tradeoffs,
      decisionDraft: null,
      status: "proposed",
      validation: evaluation.result,
      ops: stored.ops,
    };
  }

  private pause(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }
}
