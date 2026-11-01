import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatAccountingSchema, ChatPresentationSchema, type ChatAccounting, type ChatOutcome, type ChatPresentation, type ConversationDetail } from "../../src/api/http.ts";
import type { AgentRunSnapshot } from "../../src/api/agent-runs.ts";
import { PresentationSchema } from "../../src/persistence/chat-presentations.ts";
import { TurnUsage } from "../../src/web/chat/TurnUsage.tsx";
import { CarriedThreadView } from "../../src/web/chat/CarriedThread.tsx";
import { EMPTY, fromConversation, transcriptReducer, type AssistantTurn } from "../../src/web/chat/transcript.ts";

const usage = { inputTokens: 1_000, outputTokens: 200, cacheReadTokens: 5_000, cacheCreationTokens: 100 };
const accounting: ChatAccounting = { provider: "anthropic", model: "claude-opus-5-5", usage };
const render = (value: ChatAccounting | undefined) => renderToStaticMarkup(createElement(TurnUsage, { accounting: value }));
const presentation = (owner: string, value?: ChatAccounting): ChatPresentation => ({
  version: 1, userMessageId: owner, status: "completed", messages: [{ id: "public_1", kind: "answer", text: "Done." }], operations: [], effectsMayHaveOccurred: false, warning: null, detailsTruncated: false,
  ...(value === undefined ? {} : { accounting: value }),
});
const detail = (presentations?: ChatPresentation[]): ConversationDetail => ({
  conversation: { id: "c", layoutId: "l", provider: "anthropic", model: "unrelated-model", title: "Synthetic", createdAt: 1 },
  messages: [{ id: "u1", role: "user", text: "First", toolCalls: [], selection: null, createdAt: 1 }, { id: "a1", role: "assistant", text: "Done.", toolCalls: [], selection: null, createdAt: 2 }],
  proposals: [], priorities: [], ...(presentations === undefined ? {} : { presentations }),
});
const replies = (state: ReturnType<typeof fromConversation>) => state.turns.filter((turn): turn is AssistantTurn => turn.kind === "assistant");
const outcome: ChatOutcome = { ...accounting, conversationId: "c", messageIds: ["u1", "a1"], status: "complete", text: "Done.", effort: "medium", iterations: 1, priorities: [], proposals: [] };

describe("per-turn cost wording", () => {
  test("reports all token categories without folding cached tokens into uncached input", () => {
    const html = render(accounting);
    expect(html).toContain("1,000 input · 200 output · 5,000 cache read · 100 cache write tokens");
    // $0.004 input + $0.004 output + $0.001 cache read + $0.0005 cache write.
    expect(html).toContain("$0.0095 USD estimated");
    expect(html).toContain('<span class="sr-only">Turn usage and cost: </span>');
    expect(html).not.toContain("aria-label");
  });

  test("reported costs override list prices, including a reported zero", () => {
    expect(render({ ...accounting, costUsd: 0.123456 })).toContain("$0.1235 USD reported");
    expect(render({ ...accounting, costUsd: 0.123456 })).not.toContain("estimated");
    expect(render({ ...accounting, costUsd: 0 })).toContain("$0.0000 USD reported");
    expect(render({ ...accounting, costUsd: 0.000001 })).toContain("&lt;$0.0001 USD reported");
  });

  test("only exact known model/provider pairs get a list-price estimate", () => {
    expect(render({ ...accounting, provider: "openrouter", model: "anthropic/claude-opus-5.5" })).toContain("$0.0095 USD estimated");
    for (const value of [
      { ...accounting, model: "claude-opus-5-5-future" }, { ...accounting, model: "__proto__" },
      { ...accounting, provider: "openrouter" as const }, { ...accounting, provider: "codex" as const, model: "gpt-5" },
    ]) {
      const html = render(value);
      expect(html).toContain("Cost not reported · estimate unavailable");
      expect(html).toContain("1,000 input");
      expect(html).not.toContain("$");
    }
    expect(render({ ...accounting, provider: "codex", model: "unknown", costUsd: 0.4 })).toContain("$0.4000 USD reported");
  });

  test("legacy, interrupted and all-zero sentinel usage never become a free-turn estimate", () => {
    for (const value of [undefined, { ...accounting, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 } }]) {
      const html = render(value);
      expect(html).toBe("");
      expect(html).not.toContain("$");
      expect(html).not.toContain("0 input");
    }
  });

  test("small positive estimates do not round down to zero", () => {
    expect(render({ ...accounting, usage: { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 } })).toContain("&lt;$0.0001 USD estimated");
  });
});

describe("fresh, saved-run and reopened usage parity", () => {
  test("done retains facts and the same footer is reconstructed from recorded history", () => {
    let state = transcriptReducer(EMPTY, { type: "sent", userId: "local-u", assistantId: "local-a", text: "First", selection: null });
    state = transcriptReducer(state, { type: "event", event: { type: "start", conversationId: "c", messageId: "u1" } });
    state = transcriptReducer(state, { type: "event", event: { type: "done", outcome: { ...outcome, costUsd: 0.05 } } });
    const fresh = replies(state)[0]?.accounting;
    expect(fresh).toEqual({ ...accounting, costUsd: 0.05 });
    const saved = detail([presentation("u1", { ...accounting, costUsd: 0.05 })]);
    expect(replies(fromConversation(saved))[0]?.accounting).toEqual(fresh);
    expect(render(replies(fromConversation(saved))[0]?.accounting)).toBe(render(fresh));
    // A replay of a legacy presentation cannot erase a done frame's accounting.
    const replay = transcriptReducer(state, { type: "event", event: { type: "presentation", presentation: presentation("u1") } });
    expect(replies(replay)[0]?.accounting).toEqual(fresh);
  });

  test("saved snapshots replace the matching request once, and stale sequences cannot replace its usage", () => {
    const saved = detail([presentation("u1", accounting)]);
    const snapshot: AgentRunSnapshot = { version: 1, id: "run", requestId: "request", conversationId: "c", userMessageId: "u1", status: "completed", seq: 3, cancelRequested: false, committedPreparations: 0, preparations: [], presentation: saved.presentations?.[0] ?? null };
    const loaded = transcriptReducer(EMPTY, { type: "saved", snapshot, detail: saved });
    expect(replies(loaded)).toHaveLength(1);
    expect(replies(loaded)[0]?.accounting).toEqual(accounting);
    expect(transcriptReducer(loaded, { type: "saved", snapshot: { ...snapshot, seq: 2 }, detail: detail([presentation("u1", { ...accounting, costUsd: 99 })]) })).toBe(loaded);
    expect(transcriptReducer(loaded, { type: "saved", snapshot, detail: saved })).toBe(loaded);
  });

  test("older question updates keep their own cost, never the following reply's", () => {
    const first = { ...accounting, costUsd: 0.1 };
    const second = { ...accounting, usage: { ...usage, outputTokens: 400 }, costUsd: 0.2 };
    const history = detail([presentation("u1", first), presentation("u2", second)]);
    history.messages.push({ id: "u2", role: "user", text: "Second", toolCalls: [], selection: null, createdAt: 3 });
    const loaded = fromConversation(history);
    const updated = transcriptReducer(loaded, { type: "event", event: { type: "presentation", presentation: { ...presentation("u1", first), status: "completed", questionToolUseId: "q" } } });
    expect(replies(updated).map((reply) => reply.accounting)).toEqual([first, second]);
    expect(replies(updated).map((reply) => reply.userMessageId)).toEqual(["u1", "u2"]);
  });

  test("legacy history never borrows accounting from the pinned model", () => {
    expect(replies(fromConversation(detail()))[0]?.accounting).toBeUndefined();
    expect(replies(fromConversation(detail([presentation("u1")])))[0]?.accounting).toBeUndefined();
  });

  test("retry after a terminal legacy stream drops keeps the accounted turn and starts unmetered", () => {
    let state = transcriptReducer(EMPTY, { type: "sent", userId: "local-u", assistantId: "local-a", text: "First", selection: null });
    state = transcriptReducer(state, { type: "event", event: { type: "done", outcome } });
    state = transcriptReducer(state, { type: "failed", code: "stream", message: "Socket dropped after done" });
    state = transcriptReducer(state, { type: "retry", assistantId: "retry" });
    expect(replies(state).map((reply) => reply.accounting)).toEqual([accounting, undefined]);
    expect(replies(state).map((reply) => reply.phase)).toEqual(["failed", "streaming"]);
  });

  test("hidden answer requests and interrupted turns retain accounting in request order", () => {
    const id = (n: number) => `msg_${String(n).padStart(26, "0")}`;
    const first = { ...accounting, costUsd: 0.01 };
    const second = { ...accounting, costUsd: 0.02 };
    const saved = detail([presentation(id(1), first), presentation(id(3), second), { ...presentation(id(5)), status: "unobserved" }]);
    saved.messages = [
      { id: id(1), role: "user", text: "Ask", toolCalls: [], selection: null, createdAt: 1 },
      { id: id(2), role: "assistant", text: "Which?", toolCalls: ["ask_user"], selection: null, createdAt: 1 },
      // The tool-result-only answer at id(3) is not a display message.
      { id: id(4), role: "assistant", text: "Done.", toolCalls: [], selection: null, createdAt: 1 },
      { id: id(5), role: "user", text: "Interrupted", toolCalls: [], selection: null, createdAt: 1 },
    ];
    const loaded = fromConversation(saved);
    expect(replies(loaded).map((reply) => reply.userMessageId)).toEqual([id(1), id(3), id(5)]);
    expect(replies(loaded).map((reply) => reply.accounting)).toEqual([first, second, undefined]);
    const carried = renderToStaticMarkup(createElement(CarriedThreadView, { thread: { fromName: "Earlier config", turns: loaded.turns }, boardName: "Moonlander" }));
    expect(carried.match(/class="msg-usage"/g)).toHaveLength(2);
    expect(carried).toContain("$0.0100 USD reported");
    expect(carried).toContain("$0.0200 USD reported");
    expect(carried).not.toContain("Token usage not reported");
  });
});

test("wire and storage accounting schemas agree and reject invalid billing facts", () => {
  const saved = presentation("u1", { ...accounting, costUsd: 0 });
  expect(ChatPresentationSchema.parse(saved)).toEqual(PresentationSchema.parse(saved));
  expect(ChatAccountingSchema.parse(accounting)).toEqual(accounting);
  for (const costUsd of [-1, Infinity, NaN]) {
    expect(ChatPresentationSchema.safeParse(presentation("u1", { ...accounting, costUsd })).success).toBe(false);
    expect(PresentationSchema.safeParse(presentation("u1", { ...accounting, costUsd })).success).toBe(false);
  }
  expect(ChatAccountingSchema.safeParse({ ...accounting, usage: { ...usage, inputTokens: -1 } }).success).toBe(false);
});
