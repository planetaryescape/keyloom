import { expect, test } from "bun:test";
import { z } from "zod";
import { toolObserver, type AgentObservation } from "../../src/agent/observation.ts";
import type { AgentModel } from "../../src/agent/model.ts";
import { emptyUsage } from "../../src/agent/model.ts";
import { createAgentPorts } from "../../src/app/agent-ports.ts";
import { chatPresentation, clipPublicText } from "../../src/app/chat-presentation.ts";
import { sendMessage, showConversation } from "../../src/app/index.ts";
import { insertConversation, insertMessage, listMessages } from "../../src/persistence/conversations.ts";
import { listPresentations, PRESENTATION_BYTES, PresentationSchema, savePresentation } from "../../src/persistence/chat-presentations.ts";
import { ChatPresentationSchema } from "../../src/api/http.ts";
import { optionOptionApp } from "../helpers/option-option.ts";

const result = { messages: [{ role: "assistant" as const, content: [{ type: "text" as const, text: "Done." }] }], stopReason: "end_turn", iterations: 1, usage: emptyUsage() };
const model = (run: AgentModel["run"]): AgentModel => ({ provider: "anthropic", model: "synthetic", effort: "medium", classifyError: () => null, run });

test("parallel repeated tools finish against their invocation, not their name or completion order", async () => {
  const { app, layoutId } = await optionOptionApp();
  const events: AgentObservation[] = [];
  const observer = toolObserver(createAgentPorts(app, layoutId, null), (event) => events.push(event));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const inputSchema = z.object({ slow: z.boolean() });
  const [tool] = observer.wrap([{ name: "analyse_change", description: "synthetic", inputSchema, run: async (raw) => {
    const input = inputSchema.parse(raw);
    if (input.slow) await gate;
    observer.ports.check([{ op: "setBinding", at: { layerId: "layer-2", position: 30 }, binding: { kind: "key", code: input.slow ? "OPTION" : "A" } }]);
    return "raw result never enters activity";
  } }]);
  if (!tool) throw new Error("no tool");
  const first = tool.run({ slow: true });
  await tool.run({ slow: false });
  release();
  await first;
  expect(events.filter((e) => e.type === "operation_finished").map((e) => [e.operationId, e.status])).toEqual([["op_2", "succeeded"], ["op_1", "declined"]]);
  app.db.close();
});

test("operation cap and pre-aborted signal prevent future tool effects", async () => {
  const { app, layoutId } = await optionOptionApp();
  const controller = new AbortController();
  const events: AgentObservation[] = [];
  const observer = toolObserver(createAgentPorts(app, layoutId, null), (event) => events.push(event), controller.signal);
  let effects = 0;
  const [tool] = observer.wrap([{ name: "synthetic", description: "synthetic", inputSchema: z.object({}), run: () => { effects++; return "done"; } }]);
  if (!tool) throw new Error("no tool");
  for (let i = 0; i < 64; i++) await tool.run({});
  await expect(tool.run({})).rejects.toThrow(/activity limit/);
  expect(observer.limited()).toBe(true);
  controller.abort();
  await expect(tool.run({})).rejects.toThrow();
  expect(effects).toBe(64);
  expect(events.filter((e) => e.type === "operation_started")).toHaveLength(64);
  app.db.close();
});

test("bounded projection rejects raw metadata, prototype names and opaque text, and reads abandoned work as unknown", async () => {
  const { app, layoutId } = await optionOptionApp();
  const conversation = insertConversation(app.db, { layoutId, title: "Synthetic" });
  const user = insertMessage(app.db, { conversationId: conversation.id, role: "user", content: [{ type: "text", text: "Synthetic" }] });
  const projection = chatPresentation(app, conversation.id, user.id);
  for (let i = 1; i <= 64; i++) {
    projection.observe({ type: "operation_started", operationId: `op_${i}`, tool: i % 2 ? "__proto__" : "get_layout" });
    if (i === 64) break;
    projection.observe({ type: "operation_finished", operationId: `op_${i}`, status: i === 1 ? "succeeded" : "declined", durationMs: 3, accepted: 0, declined: 1, validationCodes: ["SECRET_RECORDING", "firmware_unsupported"], references: [{ kind: "config", id: "SECRET_RECORDING" }] });
  }
  projection.observe({ type: "public_message", id: "public_1", kind: "working_note", text: "😀\u0000".repeat(30_000) });
  const saved = listPresentations(app.db, conversation.id)[0];
  if (!saved) throw new Error("not saved");
  expect(Buffer.byteLength(JSON.stringify(saved))).toBeLessThan(PRESENTATION_BYTES);
  expect(saved.detailsTruncated).toBe(true);
  expect(JSON.stringify(saved)).not.toContain("SECRET_RECORDING");
  expect(saved.operations[0]).toMatchObject({ tool: "unknown", label: "Run operation", status: "unknown", validationCodes: ["validation_declined", "firmware_unsupported"], references: [] });
  expect(ChatPresentationSchema.parse(saved)).toEqual(PresentationSchema.parse(saved));
  const abandoned = showConversation(app, conversation.id).presentations[0];
  expect(abandoned?.status).toBe("unobserved");
  expect(abandoned?.operations.at(-1)?.status).toBe("unknown");
  expect(abandoned?.warning).toContain("inspect configs");
  expect(abandoned?.warning).toContain("may still be running");
  expect(clipPublicText("😀x", 4)).toBe("😀");
  expect(clipPublicText("\u0000x", 6)).toBe("\u0000");
  expect(() => savePresentation(app.db, conversation.id, { ...saved, messages: [{ id: "public_1", kind: "answer", text: "x".repeat(PRESENTATION_BYTES) }] })).toThrow(/budget/);
  // Existing conversation ownership deletes messages before the conversation (legacy FK semantics).
  app.db.run("DELETE FROM messages WHERE conversation_id = ?", [conversation.id]);
  app.db.run("DELETE FROM conversations WHERE id = ?", [conversation.id]);
  expect(listPresentations(app.db, conversation.id)).toEqual([]);
  app.db.close();
});

test("provider failure after a committed preparation retains an inspectable warning without raw exceptions", async () => {
  const { app, layoutId } = await optionOptionApp();
  let id = "";
  await expect(sendMessage(app, layoutId, {
    message: "Create", model: model(async (request) => {
      const tool = request.tools.find((t) => t.name === "create_config");
      if (!tool) throw new Error("missing create_config");
      await tool.run({ name: "SECRET_RECORDING", from: "this" });
      throw new Error("SECRET_EXCEPTION");
    }), onEvent: (event) => { if (event.type === "start") id = event.conversationId; },
  })).rejects.toThrow("SECRET_EXCEPTION");
  const presentation = showConversation(app, id).presentations[0];
  expect(presentation).toMatchObject({ status: "failed", effectsMayHaveOccurred: true });
  expect(presentation?.operations[0]?.status).toBe("succeeded");
  expect(presentation?.warning).toContain("inspect configs and proposals");
  expect(JSON.stringify(presentation)).not.toContain("SECRET_");
  app.db.close();
});

test("busy rejection and old-turn retry cannot overwrite the original presentation; hidden blocks stay out", async () => {
  const { app, layoutId } = await optionOptionApp();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let id = "";
  const first = sendMessage(app, layoutId, { message: "First", model: model(async () => { await gate; return result; }), onEvent: (e) => { if (e.type === "start") id = e.conversationId; } });
  await Promise.resolve();
  await expect(sendMessage(app, layoutId, { conversationId: id, message: "Racing", model: model(async () => result) })).rejects.toThrow(/still answering/);
  expect(listMessages(app.db, id)).toHaveLength(1);
  release();
  await first;
  await sendMessage(app, layoutId, { conversationId: id, message: "Retry is new work", model: model(async () => ({ ...result, messages: [{ role: "assistant", content: [{ type: "opaque", providerData: { thinking: "SECRET_RECORDING" } }, { type: "text", text: "Public." }] }] })) });
  const presentations = showConversation(app, id).presentations;
  expect(presentations).toHaveLength(2);
  expect(new Set(presentations.map((p) => p.userMessageId)).size).toBe(2);
  expect(presentations[0]?.messages[0]?.text).toBe("Done.");
  expect(presentations[1]?.messages[0]?.text).toBe("Public.");
  expect(JSON.stringify(presentations)).not.toContain("SECRET_RECORDING");
  app.db.close();
});
