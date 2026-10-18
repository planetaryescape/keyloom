import { expect, test } from "bun:test";
import type { AgentRunSnapshot } from "../../src/api/agent-runs.ts";
import type { ConversationDetail } from "../../src/api/http.ts";
import { EMPTY, isStreaming, transcriptReducer } from "../../src/web/chat/transcript.ts";

const detail: ConversationDetail = {
  conversation: { id: "c", layoutId: "lay", title: "Synthetic", createdAt: 1, provider: "anthropic", model: "synthetic" },
  messages: [{ id: "request", role: "user", text: "Prepare", toolCalls: [], selection: null, createdAt: 1 }], proposals: [], priorities: [],
  presentations: [{ version: 1, userMessageId: "request", status: "running", operations: [], messages: [], effectsMayHaveOccurred: false, warning: null, detailsTruncated: false }],
};
const snapshot: AgentRunSnapshot = { version: 1, id: "run", requestId: "once", conversationId: "c", userMessageId: "request", status: "running", seq: 1, cancelRequested: false, committedPreparations: 0, preparations: [], presentation: detail.presentations?.[0] ?? null };

test("saved snapshots reject duplicate/older sequences without regressing a terminal turn", () => {
  const running = transcriptReducer(EMPTY, { type: "saved", snapshot, detail });
  expect(isStreaming(running)).toBe(true);
  const completed = { ...snapshot, seq: 5, status: "completed" as const, presentation: snapshot.presentation === null ? null : { ...snapshot.presentation, status: "completed" as const, messages: [{ id: "public_1", kind: "answer" as const, text: "clipped", messageId: "answer" }] } };
  const answered: ConversationDetail = { ...detail, presentations: completed.presentation === null ? [] : [completed.presentation], messages: [...detail.messages, { id: "answer", role: "assistant", text: "Canonical answer".repeat(2000), toolCalls: [], selection: null, createdAt: 2 }] };
  const done = transcriptReducer(running, { type: "saved", snapshot: completed, detail: answered });
  expect(isStreaming(done)).toBe(false);
  expect(done.turns.at(-1)).toMatchObject({ text: "Canonical answer".repeat(2000), phase: "done" });
  expect(transcriptReducer(done, { type: "saved", snapshot, detail })).toBe(done);
  expect(transcriptReducer(done, { type: "saved", snapshot: completed, detail })).toBe(done);
});

test("saved completion is attached to its original owner, not a newer unrelated request", () => {
  const newer: ConversationDetail = { ...detail, messages: [...detail.messages, { ...detail.messages[0]!, id: "newer", text: "Another request" }], presentations: [...(detail.presentations ?? []), { ...detail.presentations![0]!, userMessageId: "newer" }] };
  const done = transcriptReducer(EMPTY, { type: "saved", snapshot: { ...snapshot, status: "completed", seq: 2, presentation: snapshot.presentation === null ? null : { ...snapshot.presentation, status: "completed" } }, detail: newer });
  expect(done.turns.find((turn) => turn.kind === "assistant" && turn.userMessageId === "request")).toMatchObject({ phase: "done" });
  expect(done.turns.find((turn) => turn.kind === "assistant" && turn.userMessageId === "newer")?.kind).toBe("assistant");
});
