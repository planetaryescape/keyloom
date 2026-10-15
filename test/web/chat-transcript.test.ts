import { describe, expect, test } from "bun:test";
import type { ChatEvent, ChatOutcome, ConversationDetail, PriorityCard, ProposalCard } from "../../src/api/http.ts";
import { EMPTY, fromConversation, isStreaming, lastUser, transcriptReducer, type Action, type AssistantTurn, type Transcript } from "../../src/web/chat/transcript.ts";

const validation: ProposalCard["validation"] = { ok: true, errors: [], warnings: [], diff: { changed: [], displaced: [], dropped: [], relearnCount: 0, retuned: [], reminders: [] } };
const card = (id: string, status: ProposalCard["status"] = "proposed"): ProposalCard => ({
  changeSetId: id, proposalGroup: null, title: id, explanation: "why", tradeoffs: { gains: [], costs: [] }, decisionDraft: null, status, validation, ops: [],
});
const outcome = (over: Partial<ChatOutcome> = {}): ChatOutcome => ({
  conversationId: "c1", messageIds: ["m1"], status: "complete", text: "", proposals: [], priorities: [], provider: "anthropic", model: "m", effort: "medium",
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }, iterations: 1, ...over,
});

const run = (actions: Action[], from: Transcript = EMPTY) => actions.reduce(transcriptReducer, from);
const sent: Action = { type: "sent", userId: "u1", assistantId: "a1", text: "hi", selection: { layerId: "base", positions: [32] } };
const ev = (event: ChatEvent): Action => ({ type: "event", event });
const assistant = (t: Transcript) => t.turns.findLast((turn): turn is AssistantTurn => turn.kind === "assistant");

describe("a streamed reply", () => {
  test("text deltas build up, a tool shows as quiet activity, and the next text clears it", () => {
    const t = run([
      sent,
      ev({ type: "start", conversationId: "c1", messageId: "m1" }),
      ev({ type: "tool", name: "get_layout" }),
    ]);
    expect(assistant(t)?.activity).toBe("Looking at your layout…");
    const after = run([ev({ type: "text", delta: "Hel" }), ev({ type: "text", delta: "lo" })], t);
    expect(assistant(after)).toMatchObject({ text: "Hello", activity: null, phase: "streaming" });
    expect(isStreaming(after)).toBe(true);
    expect(after.conversationId).toBe("c1");
  });

  test("the user turn carries the selection that was sent", () => {
    expect(lastUser(run([sent]))?.selection).toEqual({ layerId: "base", positions: [32] });
  });

  test("done ends streaming, keeps the streamed text, and merges proposals the stream didn't carry", () => {
    const t = run([
      sent,
      ev({ type: "text", delta: "streamed" }),
      ev({ type: "proposal", proposal: card("p1") }),
      ev({ type: "done", outcome: outcome({ text: "other", proposals: [card("p1"), card("p2")] }) }),
    ]);
    expect(assistant(t)).toMatchObject({ phase: "done", text: "streamed", ending: "complete" });
    expect(assistant(t)?.proposals.map((p) => p.changeSetId)).toEqual(["p1", "p2"]);
    expect(isStreaming(t)).toBe(false);
  });

  test("when no text streamed, the outcome's text fills in; an incomplete ending is recorded", () => {
    const t = run([sent, ev({ type: "done", outcome: outcome({ text: "whole", status: "truncated" }) })]);
    expect(assistant(t)).toMatchObject({ text: "whole", ending: "truncated" });
  });

  test("an error frame keeps the partial text and marks the reply failed", () => {
    const t = run([sent, ev({ type: "text", delta: "part" }), ev({ type: "error", code: "model_connection", message: "dropped" })]);
    expect(assistant(t)).toMatchObject({ phase: "failed", text: "part", failure: { code: "model_connection", message: "dropped" } });
  });

  test("stopping keeps what came through, and only a streaming reply can be stopped", () => {
    const t = run([sent, ev({ type: "text", delta: "so far" }), { type: "stopped" }]);
    expect(assistant(t)).toMatchObject({ phase: "stopped", text: "so far" });
    const done = run([sent, ev({ type: "done", outcome: outcome({ text: "x" }) }), { type: "stopped" }]);
    expect(assistant(done)?.phase).toBe("done");
  });
});

describe("refusals and retries", () => {
  test("a refusal before the stream opens leaves no trace of the turn", () => {
    const first = run([sent, ev({ type: "done", outcome: outcome({ text: "ok" }) })]);
    const t = run([{ type: "sent", userId: "u2", assistantId: "a2", text: "again", selection: null }, { type: "rolledBack" }], first);
    expect(t.turns).toEqual(first.turns);
  });

  test("retry replaces the failed reply with a fresh one and keeps the user's message", () => {
    const failed = run([sent, ev({ type: "error", code: "x", message: "y" })]);
    const t = run([{ type: "retry", assistantId: "a2" }], failed);
    expect(t.turns.map((turn) => `${turn.kind}:${turn.id}`)).toEqual(["user:u1", "assistant:a2"]);
    expect(assistant(t)?.phase).toBe("streaming");
  });
});

describe("applying a proposal", () => {
  test("marks it applied and supersedes its still-open siblings, in its own turn only", () => {
    const base = run([
      sent,
      ev({ type: "proposal", proposal: card("p1") }),
      ev({ type: "proposal", proposal: card("p2") }),
      ev({ type: "proposal", proposal: card("p3", "rejected") }),
      ev({ type: "done", outcome: outcome() }),
      { type: "sent", userId: "u2", assistantId: "a2", text: "more", selection: null },
      ev({ type: "proposal", proposal: card("q1") }),
    ]);
    const t = run([{ type: "applied", changeSetId: "p2" }], base);
    const first = t.turns.find((turn): turn is AssistantTurn => turn.kind === "assistant" && turn.id === "a1");
    const second = t.turns.find((turn): turn is AssistantTurn => turn.kind === "assistant" && turn.id === "a2");
    expect(first?.proposals.map((p) => p.status)).toEqual(["superseded", "applied", "rejected"]);
    expect(second?.proposals.map((p) => p.status)).toEqual(["proposed"]);
  });
});

describe("fromConversation", () => {
  const detail: ConversationDetail = {
    conversation: { id: "c9", layoutId: "l", title: "t", provider: "anthropic", model: null, createdAt: 1 },
    messages: [
      { id: "m1", role: "user", text: "hi", toolCalls: [], selection: null, createdAt: 1 },
      { id: "m2", role: "assistant", text: "hello", toolCalls: ["get_layout"], selection: null, createdAt: 2 },
    ],
    proposals: [card("p1", "applied")],
    priorities: [],
  };

  test("stored messages become finished turns, with the proposals on the last reply", () => {
    const t = fromConversation(detail);
    expect(t.conversationId).toBe("c9");
    expect(t.turns.map((turn) => turn.kind)).toEqual(["user", "assistant"]);
    expect(assistant(t)).toMatchObject({ phase: "done", proposals: [{ changeSetId: "p1", status: "applied" }] });
  });

  test("proposals with no reply to hang off still show", () => {
    const t = fromConversation({ ...detail, messages: [detail.messages[0]!] });
    expect(assistant(t)?.proposals).toHaveLength(1);
  });
});

describe("priority chips", () => {
  const chip = (id: string, sourceMessageIds: string[] = []): PriorityCard => ({
    id, priorityKind: "pinned", statement: "keep Backspace", reason: "stated by BK", subject: { functions: ["key:BACKSPACE"] }, sourceMessageIds, createdAt: 1,
  });

  test("a priority event adds a chip to the reply, once, and done merges any the stream missed", () => {
    const t = run([
      sent,
      ev({ type: "priority", priority: chip("d1") }),
      ev({ type: "priority", priority: chip("d1") }),
      ev({ type: "done", outcome: outcome({ priorities: [chip("d1"), chip("d2")] }) }),
    ]);
    expect(assistant(t)?.priorities.map((p) => p.id)).toEqual(["d1", "d2"]);
  });

  test("removing a chip drops it from every reply", () => {
    const t = run([sent, ev({ type: "priority", priority: chip("d1") }), ev({ type: "priority", priority: chip("d2") }), { type: "priorityRemoved", id: "d1" }]);
    expect(assistant(t)?.priorities.map((p) => p.id)).toEqual(["d2"]);
  });

  test("a reopened conversation puts each chip under the first reply after the message it came from", () => {
    const detail: ConversationDetail = {
      conversation: { id: "c9", layoutId: "l", title: "t", provider: "anthropic", model: null, createdAt: 1 },
      messages: [
        { id: "m1", role: "user", text: "hi", toolCalls: [], selection: null, createdAt: 1 },
        { id: "m2", role: "assistant", text: "which?", toolCalls: [], selection: null, createdAt: 2 },
        { id: "m3", role: "user", text: "keep Backspace", toolCalls: [], selection: null, createdAt: 3 },
        { id: "m4", role: "assistant", text: "noted", toolCalls: [], selection: null, createdAt: 4 },
        { id: "m5", role: "assistant", text: "and here", toolCalls: [], selection: null, createdAt: 5 },
      ],
      proposals: [],
      priorities: [chip("d1", ["m3"]), chip("orphan", ["gone"])],
    };
    const turns = fromConversation(detail).turns.filter((turn): turn is AssistantTurn => turn.kind === "assistant");
    expect(turns.map((turn) => turn.priorities.map((p) => p.id))).toEqual([[], ["d1"], ["orphan"]]);
  });
});
