import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { codexModel } from "../../src/agent/codex-model.ts";
import type { AgentModel } from "../../src/agent/model.ts";
import { sendMessage, showConversation, listConfigs } from "../../src/app/index.ts";
import { ChatPresentationSchema, type ChatPresentation } from "../../src/api/http.ts";
import { fakeAnthropic, type ScriptStep } from "../helpers/fake-anthropic.ts";
import { fakeCodex } from "../helpers/fake-codex.ts";
import { optionOptionApp } from "../helpers/option-option.ts";
import { tempDir } from "../helpers/tmp.ts";
import { draft } from "../helpers/ops.ts";
import { listMessages } from "../../src/persistence/conversations.ts";

type Provider = "anthropic" | "openrouter" | "codex";
type Step = { say: string } | { call: string; input: unknown };
function scripted(provider: Provider, steps: Step[]): AgentModel {
  if (provider === "codex") {
    const fake = fakeCodex({ steps });
    const home = tempDir("activity-codex-");
    writeFileSync(join(home, "auth.json"), "{}");
    return codexModel({ env: { PATH: process.env.PATH, CODEX_HOME: home, KEYLOOM_CODEX_BIN: fake.bin } });
  }
  const script: ScriptStep[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    const next = steps[i + 1];
    if ("say" in step && next && "call" in next) {
      script.push({ blocks: [{ text: step.say }, { tool: next.call, input: next.input }] });
      i++;
    } else script.push({ blocks: "say" in step ? [{ text: step.say }] : [{ tool: step.call, input: step.input }] });
  }
  return anthropicModel(fakeAnthropic(script, provider === "openrouter" ? { apiKey: null, authToken: "synthetic", baseURL: "https://openrouter.ai/api" } : {}).client, { provider });
}
const alternative = (code: string) => ({ title: "Synthetic", explanation: "Synthetic", tradeoffs: { gains: [], costs: [] }, decisionDraft: draft(), ops: [{ op: "setBinding", at: { layerId: "layer-2", position: 30 }, binding: { kind: "key", code } }] });
const question = { question: "Keep or replace?", options: [{ label: "Keep" }, { label: "Replace" }], considerations: ["It changes the proposal."], step: { n: 1, of: 1 } };

for (const provider of ["anthropic", "openrouter", "codex"] satisfies Provider[]) describe(`${provider} honest activity`, () => {
  test("valid input with prototype-named extra keys cannot change tool routing or pollute activity", async () => {
    const { app, layoutId } = await optionOptionApp();
    const input = JSON.parse('{"function":"mod:LALT","__proto__":{"polluted":"SECRET_RECORDING"},"constructor":{"prototype":{"polluted":true}}}');
    const out = await sendMessage(app, layoutId, { message: "Find Option", model: scripted(provider, [{ call: "find_function", input }, { say: "Found." }]) });
    const presentation = showConversation(app, out.conversationId).presentations[0];
    expect(presentation?.operations[0]).toMatchObject({ tool: "find_function", label: "Find function", status: "succeeded" });
    expect({}).not.toHaveProperty("polluted");
    expect(JSON.stringify(presentation)).not.toContain("SECRET_RECORDING");
    app.db.close();
  });

  test("activity allowlists exclude valid priority statements and macro text, not just malformed input", async () => {
    const { app, layoutId } = await optionOptionApp();
    const out = await sendMessage(app, layoutId, { message: "Prepare", model: scripted(provider, [
      { call: "record_priority", input: { priorityKind: "pinned", statement: "SECRET_PRIORITY_RECORDING", reason: "SECRET_REASON", subject: { functions: ["key:BACKSPACE"] } } },
      { call: "propose_changes", input: { alternatives: [{ ...alternative("A"), ops: [
        { op: "upsertMacro", macro: { id: "synthetic-macro", name: "SECRET_MACRO_NAME", steps: [{ op: "text", text: "SECRET_MACRO_RECORDING" }] } },
        { op: "setBinding", at: { layerId: "layer-2", position: 30 }, binding: { kind: "macro", macroId: "synthetic-macro" } },
      ] }] } }, { say: "Prepared for review." },
    ]) });
    expect(out.priorities).toHaveLength(1);
    expect(out.proposals).toHaveLength(1);
    const presentation = showConversation(app, out.conversationId).presentations[0];
    expect(presentation?.operations.map((o) => o.status)).toEqual(["succeeded", "succeeded"]);
    expect(presentation?.operations.every((o) => o.references.length > 0)).toBe(true);
    expect(JSON.stringify(presentation)).not.toContain("SECRET_");
    app.db.close();
  });

  test("correlates real starts, failures, declined and mixed validation; public message groups survive reload", async () => {
    const { app, layoutId } = await optionOptionApp();
    const snapshots: ChatPresentation[] = [];
    const out = await sendMessage(app, layoutId, {
      message: "Inspect", presentationVersion: 1,
      model: scripted(provider, [
        { say: "Checking." }, { call: "get_layout", input: { layers: ["layer-0"] } },
        { call: "find_function", input: { function: { SECRET_RECORDING: "never expose this" } } },
        { call: "propose_changes", input: { alternatives: [alternative("SECRET_RECORDING")] } },
        { call: "propose_changes", input: { alternatives: [alternative("A")] } },
        { say: "Finished." },
      ]), onEvent: (e) => { if (e.type === "presentation") snapshots.push(ChatPresentationSchema.parse(e.presentation)); },
    });
    const final = snapshots.at(-1);
    if (!final) throw new Error("missing terminal snapshot");
    expect(final?.status).toBe("completed");
    expect(final?.operations.map((o) => o.status)).toEqual(["succeeded", "failed", "declined", "succeeded"]);
    expect(final?.operations.map((o) => o.id)).toEqual(["op_1", "op_2", "op_3", "op_4"]);
    expect(final?.operations[2]?.validationCodes).toContain("firmware_unsupported");
    expect(final?.operations[3]).toMatchObject({ accepted: 1, declined: 0 });
    expect(final?.messages.map(({ kind, text }) => ({ kind, text }))).toEqual([{ kind: "working_note", text: "Checking." }, { kind: "answer", text: "Finished." }]);
    expect(final?.messages.every((m) => m.messageId?.startsWith("msg_"))).toBe(true);
    expect(showConversation(app, out.conversationId).presentations).toEqual([final]);
    expect(JSON.stringify(snapshots)).not.toContain("SECRET_RECORDING");
    expect(snapshots.some((p) => p.operations.some((o) => o.status === "running"))).toBe(true);
    // Previously delivered frames are immutable snapshots, not references to later updates.
    expect(snapshots[0]?.operations).toEqual([]);
    const error = listMessages(app.db, out.conversationId).flatMap((m) => m.content).find((block) => block.type === "tool_result" && String(block.content).includes("invalid input for find_function"));
    expect(error?.is_error).toBe(true);
    app.db.close();
  });

  test("question waiting is persisted even when the provider bypasses the tool handler; stale answer refused", async () => {
    const { app, layoutId } = await optionOptionApp();
    const seen: ChatPresentation[] = [];
    const out = await sendMessage(app, layoutId, { message: "Ask", presentationVersion: 1, model: scripted(provider, [{ call: "ask_user", input: question }, { say: "SECRET_POST_QUESTION" }]), onEvent: (e) => { if (e.type === "presentation") seen.push(e.presentation); } });
    const presentation = showConversation(app, out.conversationId).presentations[0];
    expect(presentation?.status).toBe("waiting_user");
    expect(presentation?.operations.some((o) => o.status === "running")).toBe(false);
    expect(JSON.stringify(seen)).not.toContain("SECRET_POST_QUESTION");
    const toolUseId = out.question?.toolUseId;
    if (!toolUseId) throw new Error("missing question");
    await sendMessage(app, layoutId, { conversationId: out.conversationId, answer: { toolUseId, text: "Keep" }, model: scripted(provider, [{ say: "Kept." }]) });
    await expect(sendMessage(app, layoutId, { conversationId: out.conversationId, answer: { toolUseId, text: "Replace" }, model: scripted(provider, []) })).rejects.toThrow(/not open/);
    expect(showConversation(app, out.conversationId).presentations).toHaveLength(2);
    expect(showConversation(app, out.conversationId).presentations[0]).toMatchObject({ status: "completed", questionToolUseId: toolUseId });
    app.db.close();
  });

  test("malformed ask_user is a failed operation, not an unanswerable waiting state", async () => {
    const { app, layoutId } = await optionOptionApp();
    const out = await sendMessage(app, layoutId, { message: "Ask", model: scripted(provider, [
      { call: "ask_user", input: { question: 7, options: "SECRET_RECORDING" } },
      { call: "ask_user", input: question },
    ]) });
    expect(out.status).toBe("awaiting_answer");
    expect(out.question?.question).toBe(question.question);
    const presentation = showConversation(app, out.conversationId).presentations[0];
    expect(presentation?.status).toBe("waiting_user");
    expect(presentation?.operations[0]?.status).toBe("failed");
    expect(JSON.stringify(presentation)).not.toContain("SECRET_RECORDING");
    app.db.close();
  });

  test("Stop after preparation preserves safe effect references and an explicit non-rollback warning", async () => {
    const { app, layoutId } = await optionOptionApp();
    const controller = new AbortController();
    const base = scripted(provider, [{ call: "create_config", input: { name: "SECRET_RECORDING", from: "this" } }, { say: "Created." }]);
    const model: AgentModel = { ...base, run: (request) => base.run({ ...request, tools: request.tools.map((tool) => tool.name !== "create_config" ? tool : { ...tool, run: async (raw) => { const result = await tool.run(raw); controller.abort(); return result; } }) }) };
    let id = "";
    await expect(sendMessage(app, layoutId, { message: "Create", model, signal: controller.signal, onEvent: (e) => { if (e.type === "start") id = e.conversationId; } })).rejects.toThrow(/abort/i);
    const presentation = showConversation(app, id).presentations[0];
    expect(presentation).toMatchObject({ status: "cancelled", effectsMayHaveOccurred: true });
    expect(presentation?.operations[0]).toMatchObject({ status: "succeeded", references: [{ kind: "config", id: expect.stringMatching(/^lay_/) }] });
    expect(presentation?.warning).toContain("Stop is not rollback");
    expect(presentation?.warning).not.toContain("Nothing was changed");
    expect(JSON.stringify(presentation)).not.toContain("SECRET_RECORDING");
    expect(listConfigs(app).some((c) => c.name === "SECRET_RECORDING")).toBe(true);
    app.db.close();
  });
});
