import { expect, test } from "bun:test";
import { codexModel } from "../../src/agent/codex-model.ts";
import { sendMessage, showConversation } from "../../src/app/index.ts";
import { fakeCodex } from "../helpers/fake-codex.ts";
import { optionOptionApp } from "../helpers/option-option.ts";
import { tempDir } from "../helpers/tmp.ts";
import type { AgentModel } from "../../src/agent/model.ts";
import { listMessages } from "../../src/persistence/conversations.ts";
import { neutralBlock } from "../../src/agent/blocks.ts";

test("a buffered failed question completion cannot claim the later valid question's pause", async () => {
  const fake = fakeCodex({ steps: [
    { call: "ask_user", input: { question: 7, options: "PRIVATE_CANARY" }, deferCompletion: true },
    { call: "ask_user", input: { question: "Keep or replace?", options: [{ label: "Keep" }, { label: "Replace" }] } },
  ] });
  const { app, layoutId } = await optionOptionApp();
  try {
    const result = await sendMessage(app, layoutId, {
      message: "Ask first",
      model: codexModel({ env: { PATH: process.env.PATH, CODEX_HOME: tempDir("codex-pause-order-"), KEYLOOM_CODEX_BIN: fake.bin } }),
    });
    expect(result.status).toBe("awaiting_answer");
    expect(result.question).toMatchObject({ question: "Keep or replace?", toolUseId: expect.stringMatching(/^codex_.+_item_1$/) });
    const presentation = showConversation(app, result.conversationId).presentations[0];
    expect(presentation?.status).toBe("waiting_user");
    expect(presentation?.operations.map((operation) => operation.status)).toEqual(["failed", "succeeded"]);
    expect(JSON.stringify(presentation)).not.toContain("PRIVATE_CANARY");
  } finally {
    app.db.close();
  }
});

test("a buffered Codex-reported failure with valid arguments cannot replace the successful question", async () => {
  const question = { question: "Keep or replace?", options: [{ label: "Keep" }, { label: "Replace" }] };
  const fake = fakeCodex({ steps: [
    { call: "ask_user", input: question, codexError: "PRIVATE_FAILURE", deferCompletion: true },
    { call: "ask_user", input: question },
  ] });
  const base = codexModel({ env: { PATH: process.env.PATH, CODEX_HOME: tempDir("codex-pause-error-"), KEYLOOM_CODEX_BIN: fake.bin } });
  let first = true;
  const model: AgentModel = { ...base, run: (request) => base.run({ ...request, tools: request.tools.map((tool) => tool.name !== "ask_user" ? tool : {
    ...tool,
    run(raw) {
      // Model an execution failure despite schema-valid arguments, before the actual question handler can pause.
      if (first) { first = false; throw new Error("PRIVATE_FAILURE"); }
      return tool.run(raw);
    },
  }) }) };
  const { app, layoutId } = await optionOptionApp();
  try {
    const result = await sendMessage(app, layoutId, { message: "Ask first", model });
    expect(result.status).toBe("awaiting_answer");
    expect(result.question).toMatchObject({ question: question.question, toolUseId: expect.stringMatching(/^codex_.+_item_1$/) });
    const stored = listMessages(app.db, result.conversationId).flatMap((message) => message.content.map(neutralBlock));
    const failed = stored.find((block) => block.type === "tool_result" && block.tool_use_id.endsWith("_item_0"));
    expect(failed?.type === "tool_result" && failed.is_error).toBe(true);
    expect(stored.some((block) => block.type === "tool_result" && block.tool_use_id === result.question?.toolUseId)).toBe(false);
    const presentation = showConversation(app, result.conversationId).presentations[0];
    expect(presentation?.status).toBe("waiting_user");
    expect(JSON.stringify(presentation)).not.toContain("PRIVATE_FAILURE");
  } finally {
    app.db.close();
  }
});

test("a failed malformed question alone does not create an unanswerable waiting state", async () => {
  const fake = fakeCodex({ steps: [
    { call: "ask_user", input: { question: 7, options: "PRIVATE_CANARY" } },
    { say: "The question could not be prepared." },
  ] });
  const { app, layoutId } = await optionOptionApp();
  try {
    const result = await sendMessage(app, layoutId, { message: "Ask first", model: codexModel({ env: { PATH: process.env.PATH, CODEX_HOME: tempDir("codex-pause-invalid-"), KEYLOOM_CODEX_BIN: fake.bin } }) });
    expect(result.status).toBe("complete");
    expect(result.question).toBeUndefined();
    const presentation = showConversation(app, result.conversationId).presentations[0];
    expect(presentation?.status).toBe("completed");
    expect(presentation?.operations.map((operation) => operation.status)).toEqual(["failed"]);
    expect(JSON.stringify(presentation)).not.toContain("PRIVATE_CANARY");
  } finally {
    app.db.close();
  }
});
