import { describe, expect, test } from "bun:test";
import type { ChatOutcome, ChatPresentation, ConversationDetail, ProposalCard } from "../../src/api/http.ts";
import { EMPTY, fromConversation, isStreaming, transcriptReducer, type Action, type AssistantTurn, type Transcript } from "../../src/web/chat/transcript.ts";

const presentation = (over: Partial<ChatPresentation> = {}): ChatPresentation => ({
  version: 1, userMessageId: "request-1", status: "running", messages: [], operations: [], effectsMayHaveOccurred: false, warning: null, detailsTruncated: false, ...over,
});
const operation = (status: ChatPresentation["operations"][number]["status"], id = "op_1"): ChatPresentation["operations"][number] => ({
  id, tool: "propose_changes", label: "Prepare proposals", status, durationMs: 4, validationCodes: [], references: [], accepted: 0, declined: 0,
});
const outcome = (over: Partial<ChatOutcome> = {}): ChatOutcome => ({
  conversationId: "c", messageIds: ["request-1"], status: "complete", text: "Answer", proposals: [], priorities: [], provider: "anthropic", model: "synthetic", effort: "medium",
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }, iterations: 1, ...over,
});
const sent: Action = { type: "sent", userId: "local-user", assistantId: "local-reply", text: "Inspect", selection: null };
const start: Action = { type: "event", event: { type: "start", conversationId: "c", messageId: "request-1" } };
const frame = (snapshot: ChatPresentation): Action => ({ type: "event", event: { type: "presentation", presentation: snapshot } });
const run = (actions: Action[], state: Transcript = EMPTY) => actions.reduce(transcriptReducer, state);
const assistants = (state: Transcript) => state.turns.filter((turn): turn is AssistantTurn => turn.kind === "assistant");
const validation: ProposalCard["validation"] = { ok: true, errors: [], warnings: [], diff: { changed: [], displaced: [], dropped: [], relearnCount: 0, retuned: [], reminders: [] } };
const proposal = (id: string): ProposalCard => ({ changeSetId: id, proposalGroup: null, title: "Synthetic", explanation: "Synthetic", tradeoffs: { gains: [], costs: [] }, decisionDraft: null, status: "proposed", validation, ops: [] });

describe("observed transcript ownership", () => {
  test("a terminal snapshot does not release the current socket before its done/error frame", () => {
    const snapshot = presentation({ status: "completed", messages: [{ id: "public_1", kind: "answer", text: "Answer" }] });
    const observed = run([sent, start, frame(snapshot)]);
    expect(isStreaming(observed)).toBe(true);
    const done = run([{ type: "event", event: { type: "done", outcome: outcome() } }], observed);
    expect(isStreaming(done)).toBe(false);
  });

  test("start binds the server owner without replacing local keys; snapshots replace notes and never duplicate deltas", () => {
    const snapshot = presentation({ status: "completed", messages: [{ id: "public_1", kind: "working_note", text: "Checking" }, { id: "public_2", kind: "answer", text: "Answer" }] });
    const state = run([sent, start, { type: "event", event: { type: "text", delta: "legacy note" } }, frame(snapshot), frame(snapshot), { type: "event", event: { type: "text", delta: "duplicate final" } }, { type: "event", event: { type: "done", outcome: outcome() } }]);
    expect(state.turns.map((turn) => turn.id)).toEqual(["local-user", "local-reply"]);
    expect(assistants(state)[0]).toMatchObject({ userMessageId: "request-1", text: "Answer", phase: "done", activity: null, presentation: snapshot });
    expect(assistants(state)[0]?.presentation?.messages).toHaveLength(2);
    const replaced = run([frame({ ...snapshot, messages: [{ id: "public_1", kind: "answer", text: "Updated answer" }] })], state);
    expect(assistants(replaced)[0]?.text).toBe("Updated answer");
  });

  test("an older waiting snapshot resolves its own question, not the newer streaming turn", () => {
    const waiting = presentation({ status: "waiting_user", questionToolUseId: "q", messages: [{ id: "public_1", kind: "working_note", text: "Which?" }] });
    const question = { toolUseId: "q", question: "Which?", options: [{ label: "This" }], allowOther: true, answer: null };
    const state = run([sent, start, frame(waiting), { type: "event", event: { type: "done", outcome: outcome({ status: "awaiting_answer", question, text: "Which?" }) } }, { type: "answering", toolUseId: "q", text: "This", assistantId: "answer-reply" }, { type: "event", event: { type: "start", conversationId: "c", messageId: "answer-request" } }, frame({ ...waiting, status: "completed" }), frame(presentation({ userMessageId: "answer-request", messages: [{ id: "public_1", kind: "working_note", text: "Preparing" }] }))]);
    expect(assistants(state).map((turn) => [turn.userMessageId, turn.presentation?.status, turn.question?.answer, turn.text])).toEqual([["request-1", "completed", "This", ""], ["answer-request", "running", undefined, ""]]);
    expect(isStreaming(state)).toBe(true);
    // An unknown older owner must not hijack subsequent legacy proposal/done events either.
    const unknown = run([frame(presentation({ userMessageId: "older-unloaded", status: "completed" })), { type: "event", event: { type: "proposal", proposal: proposal("p") } }], state);
    expect(assistants(unknown).at(-1)?.proposals.map((card) => card.changeSetId)).toEqual(["p"]);
    expect(assistants(unknown).at(-1)?.userMessageId).toBe("answer-request");
  });
});

describe("interrupted observation", () => {
  for (const action of [{ type: "stopped" }, { type: "failed", code: "stream", message: "Disconnected" }] satisfies Action[]) {
    test(`${action.type} keeps committed references, makes only unfinished operations unknown, and never claims rollback`, () => {
      const snapshot = presentation({ effectsMayHaveOccurred: true, operations: [{ ...operation("succeeded"), references: [{ kind: "config", id: "lay_saved" }] }, operation("running", "op_2")] });
      const state = run([sent, start, frame(snapshot), action]);
      const turn = assistants(state)[0];
      expect(turn?.presentation?.operations.map((op) => op.status)).toEqual(["succeeded", "unknown"]);
      expect(turn?.presentation?.operations[0]?.references).toEqual([{ kind: "config", id: "lay_saved" }]);
      expect(turn?.presentation?.status).toBe("unobserved");
      expect(turn?.presentation?.warning).toContain("may still be running");
      expect(turn?.presentation?.warning).toContain("Stop is not rollback");
      expect(isStreaming(state)).toBe(false);
      expect(snapshot.operations[1]?.status).toBe("running");
      const late = run([frame(snapshot)], state);
      expect(assistants(late)[0]?.presentation?.status).toBe("unobserved");
      expect(isStreaming(late)).toBe(false);
      const retried = run([{ type: "retry", assistantId: "manual-retry" }], state);
      expect(assistants(retried)[0]?.presentation).toEqual(turn?.presentation);
      expect(assistants(retried)).toHaveLength(2);
    });
  }

  test("model completion does not turn failed/declined/partial/unknown operations into successes", () => {
    const statuses = ["failed", "declined", "partial", "unknown"] as const;
    const state = run([sent, start, frame(presentation({ status: "completed", operations: statuses.map((status, i) => operation(status, `op_${i}`)) })), { type: "event", event: { type: "done", outcome: outcome() } }]);
    expect(assistants(state)[0]?.presentation?.operations.map((op) => op.status)).toEqual([...statuses]);
    expect(isStreaming(state)).toBe(false);
  });
});

test("history reconstructs aborted and hidden-answer requests in generated-ID order, without orphaning controls", () => {
  const id = (n: number) => `msg_${String(n).padStart(26, "0")}`;
  const savedProposal = proposal("cs_00000000000000000000000006");
  const detail: ConversationDetail = {
    conversation: { id: "c", title: "Synthetic", layoutId: "l", provider: "anthropic", model: "synthetic", createdAt: 1 },
    messages: [
      { id: id(1), role: "user", text: "Inspect", toolCalls: [], selection: null, createdAt: 1 },
      { id: id(2), role: "assistant", text: "Which?", toolCalls: ["ask_user"], selection: null, createdAt: 1, question: { toolUseId: "q", question: "Which?", options: [{ label: "This" }], allowOther: false, answer: "This" } },
      // The answer's user/tool-result at id(3) is intentionally not public.
      { id: id(4), role: "assistant", text: "Prepared", toolCalls: [], selection: null, createdAt: 1 },
      { id: id(5), role: "user", text: "Another", toolCalls: [], selection: null, createdAt: 1 },
      // No canonical assistant was saved for this interrupted request.
    ],
    presentations: [
      presentation({ userMessageId: id(1), status: "completed", questionToolUseId: "q", messages: [{ id: "public_1", kind: "working_note", text: "Which?", messageId: id(2) }] }),
      presentation({ userMessageId: id(3), status: "completed", messages: [{ id: "public_1", kind: "answer", text: "Prepared", messageId: id(4) }] }),
      presentation({ userMessageId: id(5), status: "unobserved", warning: "Work may still be running; inspect configs and proposals.", operations: [operation("unknown")] }),
    ], proposals: [savedProposal],
    priorities: [{ id: "priority", priorityKind: "pinned", statement: "Keep it", reason: "Synthetic", subject: {}, sourceMessageIds: [id(3)], createdAt: 1 }],
  };
  const state = fromConversation(detail);
  expect(state.turns.map((turn) => turn.kind === "user" ? turn.id : turn.userMessageId)).toEqual([id(1), id(1), id(3), id(5), id(5)]);
  expect(assistants(state).map((turn) => turn.text)).toEqual(["", "Prepared", ""]);
  expect(assistants(state)[0]?.question?.answer).toBe("This");
  expect(assistants(state)[1]?.priorities.map((card) => card.id)).toEqual(["priority"]);
  expect(assistants(state)[2]?.proposals).toEqual([savedProposal]);
  expect(assistants(state)[2]?.presentation?.warning).toContain("may still be running");
  expect(isStreaming(state)).toBe(false);
});
