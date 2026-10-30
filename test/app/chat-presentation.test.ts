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

test("a reply's artifacts survive the stored row and the wire, and an older reader keeps the rest of the row", async () => {
  const { app, layoutId } = await optionOptionApp();
  const conversation = insertConversation(app.db, { layoutId, title: "Synthetic" });
  const user = insertMessage(app.db, { conversationId: conversation.id, role: "user", content: [{ type: "text", text: "Copy it" }] });
  const report = {
    kind: "transfer" as const, sourceBoard: "Moonlander", destinationBoard: "Corne", mappedCount: 42, guessedCount: 5,
    skipped: [{ key: "Esc (Base)", reason: "no key on the new board does this" }], skippedCount: 1,
    layers: [{ source: "Base", target: "Base", carried: 30, guessed: 5, notCarried: 1 }], layerCount: 1,
    combos: { copied: 1, skipped: [], skippedCount: 0 }, notes: ["LED colours were not carried"], noteCount: 1,
    placementCount: 2, placementsBlocked: 0,
  };
  const projection = chatPresentation(app, conversation.id, user.id);
  projection.artifacts([report, { kind: "keyboard_list", keyboards: [] }, report, report, report]);
  projection.finish("completed");
  const saved = listPresentations(app.db, conversation.id)[0];
  if (!saved) throw new Error("not saved");
  // A reply shows at most four cards; the fifth is counted, not kept.
  expect(saved.artifacts).toEqual([report, { kind: "keyboard_list", keyboards: [] }, report, report]);
  expect(saved.detailsTruncated).toBe(true);
  expect(ChatPresentationSchema.parse(saved)).toEqual(PresentationSchema.parse(saved));
  expect(ChatPresentationSchema.parse(saved).artifacts?.[0]).toEqual(report);

  // A row written before this field existed has no artifacts and still reads.
  app.db.query("UPDATE chat_presentations SET payload = json_remove(payload, '$.artifacts') WHERE user_message_id = ?").run(user.id);
  const older = listPresentations(app.db, conversation.id)[0];
  expect(older?.artifacts).toBeUndefined();
  expect(older?.status).toBe("completed");
  expect(ChatPresentationSchema.parse(older)).toEqual(PresentationSchema.parse(older));

  // An older binary's schema does not know the field: it drops it and keeps every field it does know.
  savePresentation(app.db, conversation.id, saved);
  const previous = PresentationSchema.omit({ artifacts: true });
  const row = app.db.query("SELECT payload FROM chat_presentations WHERE user_message_id = ?").get(user.id) as { payload: string };
  const parsed = previous.parse(JSON.parse(row.payload));
  expect(parsed.userMessageId).toBe(user.id);
  expect(parsed.status).toBe("completed");
  expect(parsed.messages).toEqual([]);
  expect("artifacts" in parsed).toBe(false);

  // A maximal copy report is still a legal row, well inside the presentation's own budget.
  const long = "W".repeat(300);
  const { transferReport } = await import("../../src/app/copy-report.ts");
  const widest = transferReport({
    ops: [], opsWithPlacements: [], placements: [],
    layers: Array.from({ length: 20 }, (_, i) => ({ source: `layer-${i}`, target: `layer-${i}`, carried: i, guessed: i, notCarried: i })),
    notCarried: Array.from({ length: 81 }, (_, i) => ({ layerName: long, source: i, sourceName: `${long} ${i}`, why: long })),
    combos: { copied: ["a", "b"], skipped: Array.from({ length: 17 }, (_, i) => ({ id: `${long} ${i}`, why: long })) },
    notes: Array.from({ length: 11 }, (_, i) => `${long} ${i}`),
  }, { sourceBoard: "S".repeat(200), destinationBoard: "D".repeat(200), layerName: (id) => long + id });
  const wide = chatPresentation(app, conversation.id, user.id);
  wide.artifacts([widest]);
  wide.finish("completed");
  const stored = listPresentations(app.db, conversation.id)[0];
  expect(stored?.artifacts).toHaveLength(1);
  expect(Buffer.byteLength(JSON.stringify(stored))).toBeLessThan(PRESENTATION_BYTES);
  // A card writer that ignores the bounds loses its card instead of the reply: the row is not saved over budget, and the loss is flagged.
  const huge = chatPresentation(app, conversation.id, user.id);
  huge.artifacts([{ kind: "transfer", notes: [long.repeat(200)] }]);
  huge.finish("completed");
  expect(listPresentations(app.db, conversation.id)[0]?.artifacts).toBeUndefined();
  expect(listPresentations(app.db, conversation.id)[0]?.detailsTruncated).toBe(true);
  app.db.close();
});
