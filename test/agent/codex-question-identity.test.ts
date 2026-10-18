import { expect, test } from "bun:test";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { codexModel } from "../../src/agent/codex-model.ts";
import { answerAgentRun, drainAgentRuns, startAgentRun, waitForAgentRun } from "../../src/app/agent-runs.ts";
import { showConversation } from "../../src/app/conversations.ts";
import { openApp } from "../../src/app/context.ts";
import { insertConversation, insertMessage, listMessages } from "../../src/persistence/conversations.ts";
import { fakeCodex, type FakeStep } from "../helpers/fake-codex.ts";
import { optionOptionApp } from "../helpers/option-option.ts";
import { tempDir } from "../helpers/tmp.ts";

function scripted(steps: FakeStep[]) {
  const fake = fakeCodex({ steps });
  symlinkSync("/dev/null", join(fake.dir, "record.json"));
  return codexModel({ env: { PATH: process.env.PATH, CODEX_HOME: tempDir("codex-question-identity-home-"), KEYLOOM_CODEX_BIN: fake.bin } });
}
const ask = (question: string) => scripted([{ call: "ask_user", input: { question, options: [{ label: "Left" }, { label: "Right" }] } }]);

test("consecutive real Codex exec questions have unique canonical IDs, different answers and idempotent continuation after reload", async () => {
  const { app, dir, layoutId } = await optionOptionApp();
  const conversation = insertConversation(app.db, { layoutId, title: "Legacy and continued questions", provider: "codex", model: "synthetic" });
  insertMessage(app.db, { conversationId: conversation.id, role: "assistant", content: [{ type: "tool_use", id: "item_0", name: "ask_user", input: { question: "Historical?", options: [{ label: "Yes" }, { label: "No" }] } }] });
  insertMessage(app.db, { conversationId: conversation.id, role: "user", content: [{ type: "tool_result", tool_use_id: "item_0", content: "Historical answer" }] });
  const legacy = listMessages(app.db, conversation.id);
  try {
    const first = await startAgentRun(app, { version: 1, requestId: "codex-first", layoutRef: layoutId, input: { conversationId: conversation.id, message: "Ask twice" } }, { model: ask("Which side?") });
    const waiting = await waitForAgentRun(app, first.id);
    const firstId = waiting.presentation?.questionToolUseId;
    if (!firstId) throw new Error("missing first question");
    expect(firstId).toMatch(/^codex_.+_item_0$/);
    const second = await answerAgentRun(app, first.id, "codex-answer-one", { toolUseId: firstId, text: "Left" }, { model: ask("Which thumb?") });
    const next = await waitForAgentRun(app, second.id);
    const secondId = next.presentation?.questionToolUseId;
    if (!secondId) throw new Error("missing second question");
    expect(secondId).toMatch(/^codex_.+_item_0$/);
    expect(secondId).not.toBe(firstId);
    expect(showConversation(app, conversation.id).messages.flatMap((message) => message.question ? [[message.question.question, message.question.answer]] : [])).toEqual([["Historical?", "Historical answer"], ["Which side?", "Left"], ["Which thumb?", null]]);
    const never = scripted([{ fail: "duplicate answer must not execute" }]);
    expect((await answerAgentRun(app, first.id, "codex-answer-one", { toolUseId: firstId, text: "Left" }, { model: never })).id).toBe(second.id);
    const third = await answerAgentRun(app, second.id, "codex-answer-two", { toolUseId: secondId, text: "Right" }, { model: scripted([{ say: "Both answers saved." }]) });
    expect((await waitForAgentRun(app, third.id)).status).toBe("completed");
    expect((await answerAgentRun(app, second.id, "codex-answer-two", { toolUseId: secondId, text: "Right" }, { model: never })).id).toBe(third.id);
    await expect(answerAgentRun(app, second.id, "codex-answer-two", { toolUseId: secondId, text: "Left" }, { model: never })).rejects.toThrow(/different scope or input/);
    const reopened = openApp({ dataDir: dir });
    try {
      expect(showConversation(reopened, conversation.id).messages.flatMap((message) => message.question ? [[message.question.question, message.question.answer]] : [])).toEqual([["Historical?", "Historical answer"], ["Which side?", "Left"], ["Which thumb?", "Right"]]);
      expect(listMessages(reopened.db, conversation.id).slice(0, 2)).toEqual(legacy);
    } finally { reopened.db.close(); }
    const blocks = listMessages(app.db, conversation.id).flatMap((message) => message.content);
    expect(blocks.filter((block) => block.type === "tool_result" && block.tool_use_id === firstId)).toHaveLength(1);
    expect(blocks.filter((block) => block.type === "tool_result" && block.tool_use_id === secondId)).toHaveLength(1);
  } finally { await drainAgentRuns(app); app.db.close(); }
});
