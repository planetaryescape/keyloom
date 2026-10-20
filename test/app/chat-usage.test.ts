import { expect, test } from "bun:test";
import type { AgentModel } from "../../src/agent/model.ts";
import { sendMessage, showConversation, openApp } from "../../src/app/index.ts";
import { startAgentRun, waitForAgentRun, drainAgentRuns, inspectAgentRun } from "../../src/app/agent-runs.ts";
import { ConversationDetailSchema, type ChatAccounting } from "../../src/api/http.ts";
import { AgentRunSnapshotSchema } from "../../src/api/agent-runs.ts";
import { runAccounting } from "../../src/persistence/agent-runs.ts";
import { fromConversation } from "../../src/web/chat/transcript.ts";
import { insertConversation, insertMessage, listMessages } from "../../src/persistence/conversations.ts";
import { optionOptionApp } from "../helpers/option-option.ts";

const usage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 300, cacheCreationTokens: 40 };
const result = { messages: [{ role: "assistant" as const, content: [{ type: "text" as const, text: "Synthetic answer." }] }], stopReason: "end_turn", iterations: 1, usage };
const model = (run: AgentModel["run"]): AgentModel => ({ provider: "openrouter", model: "synthetic-model", effort: "medium", classifyError: () => null, run });

test("normal/CLI turns persist exact usage and reported cost across database reopen, with no provider replay", async () => {
  const { app, dir, layoutId } = await optionOptionApp();
  let calls = 0;
  const fake = model(async () => ({ ...result, costUsd: ++calls === 1 ? 0.01234 : 0 }));
  try {
    const first = await sendMessage(app, layoutId, { message: "First", model: fake });
    const second = await sendMessage(app, layoutId, { message: "Second", conversationId: first.conversationId, model: fake });
    expect(first.costUsd).toBe(0.01234);
    expect(second.costUsd).toBe(0);
    expect(first.usage).toEqual(usage);
    const reopened = openApp({ dataDir: dir });
    try {
      const view = showConversation(reopened, first.conversationId);
      expect(view.presentations.map((p) => p.accounting)).toEqual([
        { provider: "openrouter", model: "synthetic-model", usage, costUsd: 0.01234 },
        { provider: "openrouter", model: "synthetic-model", usage, costUsd: 0 },
      ]);
      const transcript = fromConversation(ConversationDetailSchema.parse(view));
      expect(transcript.turns.filter((turn) => turn.kind === "assistant").map((turn) => turn.accounting?.costUsd)).toEqual([0.01234, 0]);
      expect(calls).toBe(2);
    } finally { reopened.db.close(); }
  } finally { app.db.close(); }
});

test("saved-run snapshots and history carry usage without exposing or replaying outcome content", async () => {
  const { app, layoutId } = await optionOptionApp();
  let calls = 0;
  try {
    const accepted = await startAgentRun(app, { version: 1, requestId: "usage-once", layoutRef: layoutId, input: { message: "Inspect" } }, { model: model(async () => { calls++; return { ...result, costUsd: 0.02 }; }) });
    const finished = await waitForAgentRun(app, accepted.id);
    const snapshot = AgentRunSnapshotSchema.parse(finished);
    expect(snapshot.presentation?.accounting).toEqual({ provider: "openrouter", model: "synthetic-model", usage, costUsd: 0.02 });
    const detail = ConversationDetailSchema.parse(showConversation(app, snapshot.conversationId));
    expect(detail.presentations?.[0]?.accounting).toEqual(snapshot.presentation?.accounting);
    expect(calls).toBe(1);
  } finally { await drainAgentRuns(app); app.db.close(); }
});

test("pre-footer saved runs read their existing outcome accounting without backfilling or generating history", async () => {
  const { app, layoutId } = await optionOptionApp();
  let calls = 0;
  try {
    const accepted = await startAgentRun(app, { version: 1, requestId: "older-usage", layoutRef: layoutId, input: { message: "Inspect" } }, { model: model(async () => { calls++; return { ...result, costUsd: 0.03 }; }) });
    await waitForAgentRun(app, accepted.id);
    app.db.query("UPDATE chat_presentations SET payload = json_remove(payload, '$.accounting') WHERE user_message_id = ?").run(accepted.userMessageId);
    const before = app.db.query("SELECT payload FROM chat_presentations WHERE user_message_id = ?").get(accepted.userMessageId);
    const expected: ChatAccounting = { provider: "openrouter", model: "synthetic-model", usage, costUsd: 0.03 };
    expect(showConversation(app, accepted.conversationId).presentations[0]?.accounting).toEqual(expected);
    expect(inspectAgentRun(app, accepted.id).presentation?.accounting).toEqual(expected);
    expect(app.db.query("SELECT payload FROM chat_presentations WHERE user_message_id = ?").get(accepted.userMessageId)).toEqual(before);
    expect(calls).toBe(1);
    for (const outcomeJson of [null, "not json", "{}", JSON.stringify({ ...expected, costUsd: -1 })]) expect(runAccounting(outcomeJson)).toBeUndefined();
  } finally { await drainAgentRuns(app); app.db.close(); }
});

test("question resolution and incomplete turns preserve separate usage without inventing a charge", async () => {
  const { app, layoutId } = await optionOptionApp();
  const question = { question: "Which?", options: [{ label: "This" }, { label: "That" }] };
  try {
    const first = await sendMessage(app, layoutId, { message: "Ask", model: model(async () => ({ ...result, costUsd: 0.01, stopReason: "awaiting_answer", pending: { id: "q", name: "ask_user", input: question }, messages: [{ role: "assistant", content: [{ type: "tool_use", id: "q", name: "ask_user", input: question }] }] })) });
    const second = await sendMessage(app, layoutId, { conversationId: first.conversationId, answer: { toolUseId: "q", text: "This" }, model: model(async () => ({ ...result, stopReason: "max_tokens" })) });
    expect(second.status).toBe("truncated");
    const saved = showConversation(app, first.conversationId).presentations;
    expect(saved.map((p) => p.accounting?.costUsd)).toEqual([0.01, undefined]);
    expect(saved.map((p) => p.accounting?.usage)).toEqual([usage, usage]);
    expect(saved.map((p) => p.status)).toEqual(["completed", "incomplete"]);
  } finally { app.db.close(); }
});

test("legacy and failed requests stay unmetered; saving accounting is atomic with messages", async () => {
  const { app, layoutId } = await optionOptionApp();
  try {
    const legacy = insertConversation(app.db, { layoutId, title: "Legacy" });
    insertMessage(app.db, { conversationId: legacy.id, role: "assistant", content: [{ type: "text", text: "Legacy answer" }] });
    expect(showConversation(app, legacy.id).presentations).toEqual([]);
    app.db.exec("CREATE TRIGGER fail_accounting BEFORE UPDATE ON chat_presentations WHEN json_extract(NEW.payload, '$.accounting') IS NOT NULL BEGIN SELECT RAISE(ABORT, 'accounting write failed'); END");
    let conversationId = "";
    await expect(sendMessage(app, layoutId, { message: "Atomic", model: model(async () => result), onEvent: (event) => { if (event.type === "start") conversationId = event.conversationId; } })).rejects.toThrow("accounting write failed");
    expect(listMessages(app.db, conversationId)).toHaveLength(1);
    expect(showConversation(app, conversationId).presentations[0]?.accounting).toBeUndefined();
    app.db.exec("DROP TRIGGER fail_accounting");
    await expect(sendMessage(app, layoutId, { message: "Fail", model: model(async () => { throw new Error("synthetic failure"); }), onEvent: (event) => { if (event.type === "start") conversationId = event.conversationId; } })).rejects.toThrow("synthetic failure");
    expect(showConversation(app, conversationId).presentations[0]).toMatchObject({ status: "failed" });
    expect(showConversation(app, conversationId).presentations[0]?.accounting).toBeUndefined();
  } finally { app.db.close(); }
});
