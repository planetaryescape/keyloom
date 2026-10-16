// D-111: stored blocks are neutral, a conversation is pinned to the provider that started it, and
// rows written before either (Anthropic's blocks, no provider column) still load and replay.
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { neutralBlock, wireBlock } from "../../src/agent/blocks.ts";
import { UsageError, sendMessage, showConversation } from "../../src/app/index.ts";
import { migrate } from "../../src/persistence/db.ts";
import { MIGRATIONS } from "../../src/persistence/migrations.ts";
import { findConversation, listMessages } from "../../src/persistence/conversations.ts";
import { createLayoutAtOldSchema } from "../helpers/old-schema.ts";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";
import { fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { optionOptionApp } from "../helpers/option-option.ts";

// What the code before this change stored: the SDK's blocks, verbatim.
const thinking = { type: "thinking", thinking: "the S key holds Option", signature: "c2ln==" };
const OLD_ASSISTANT = [
  thinking,
  { type: "text", text: "Let me look.", citations: null },
  { type: "tool_use", id: "toolu_old", name: "get_layout", input: { layers: ["layer-0"] }, caller: { type: "direct" } },
];
const OLD_RESULT = [{ type: "tool_result", tool_use_id: "toolu_old", content: [{ type: "text", text: "layer 0 ..." }] }];

describe("neutral blocks", () => {
  test("text, tool_use and tool_result are neutral, and what they drop stays in providerData", () => {
    expect(neutralBlock({ type: "text", text: "hi" })).toEqual({ type: "text", text: "hi" });
    expect(neutralBlock({ type: "tool_use", id: "t", name: "n", input: { a: 1 } })).toEqual({ type: "tool_use", id: "t", name: "n", input: { a: 1 } });
    expect(neutralBlock({ type: "tool_result", tool_use_id: "t", content: "ok", is_error: true })).toEqual({ type: "tool_result", tool_use_id: "t", content: "ok", is_error: true });
    const withExtra = neutralBlock({ type: "text", text: "hi", citations: null });
    expect(withExtra).toEqual({ type: "text", text: "hi", providerData: { type: "text", text: "hi", citations: null } });
    const listed = neutralBlock(OLD_RESULT[0]!);
    expect(listed).toMatchObject({ type: "tool_result", tool_use_id: "toolu_old", content: "layer 0 ...", providerData: OLD_RESULT[0] });
  });

  test("thinking is opaque, becoming neutral twice changes nothing, and the wire form is the original", () => {
    const opaque = neutralBlock(thinking);
    expect(opaque).toEqual({ type: "opaque", providerData: thinking });
    expect(wireBlock(opaque)).toEqual(thinking);
    for (const raw of [...OLD_ASSISTANT, ...OLD_RESULT]) {
      const once = neutralBlock(raw);
      expect(neutralBlock(once as { type: string })).toEqual(once);
      expect(wireBlock(once)).toEqual(raw);
    }
  });
});

describe("a database from before this change", () => {
  test("migration 0007 pins existing conversations to anthropic and leaves their messages alone", async () => {
    const board = await moonlander();
    const { layout } = await importOryxSource(FIXTURE_DIR, board.definition);
    const db = new Database(":memory:", { strict: true });
    db.run("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
    for (const m of MIGRATIONS.slice(0, 6)) {
      db.exec(m.sql);
      db.query("INSERT INTO schema_migrations VALUES (?, ?, 0)").run(m.version, m.name);
    }
    db.run("PRAGMA foreign_keys = ON");
    const created = createLayoutAtOldSchema(db, { name: "old", layout, summary: "import" });
    db.query("INSERT INTO conversations (id, layout_id, title, created_at) VALUES ('conv_old', ?, 'talk', 1)").run(created.layout.id);
    db.query("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('msg_old', 'conv_old', 'assistant', ?, 2)").run(JSON.stringify(OLD_ASSISTANT));
    const before = db.query("SELECT * FROM messages").all();

    migrate(db);

    expect(findConversation(db, "conv_old")).toMatchObject({ provider: "anthropic", model: null });
    expect(db.query("SELECT * FROM messages").all()).toEqual(before);
    expect(() => db.query("UPDATE conversations SET provider = 'openai'").run()).toThrow();
    migrate(db);
    expect(db.query("SELECT COUNT(*) AS n FROM schema_migrations").get()).toEqual({ n: MIGRATIONS.length });
  });

  test("an old conversation continues: its stored blocks reach the API byte for byte, and it stays on anthropic", async () => {
    const { app, layoutId } = await optionOptionApp();
    // Rows exactly as the old code wrote them: raw SDK blocks and the table's default provider.
    app.db.query("INSERT INTO conversations (id, layout_id, title, created_at) VALUES ('conv_old', ?, 'talk', 1)").run(layoutId);
    const put = (id: string, role: string, content: unknown, at: number) =>
      app.db.query("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, 'conv_old', ?, ?, ?)").run(id, role, JSON.stringify(content), at);
    put("msg_1", "user", [{ type: "text", text: "Option is on S" }], 2);
    put("msg_2", "assistant", OLD_ASSISTANT, 3);
    put("msg_3", "user", OLD_RESULT, 4);
    put("msg_4", "assistant", [{ type: "text", text: "Which app?" }], 5);

    const fake = fakeAnthropic([{ blocks: [{ text: "Got it." }] }]);
    await sendMessage(app, layoutId, { message: "Raycast", conversationId: "conv_old", model: anthropicModel(fake.client) });

    const sent = fake.requests[0]!.body.messages as Array<{ role: string; content: unknown[] }>;
    expect(sent[1]?.content).toEqual(OLD_ASSISTANT);
    expect(sent[2]?.content).toEqual(OLD_RESULT);
    expect(findConversation(app.db, "conv_old")).toMatchObject({ provider: "anthropic" });
    // The chat panel still reads it: text and tool names come through the neutral form.
    const view = showConversation(app, "conv_old");
    expect(view.messages.map((m) => [m.role, m.text, m.toolCalls])).toEqual([
      ["user", "Option is on S", []], ["assistant", "Let me look.", ["get_layout"]], ["assistant", "Which app?", []], ["user", "Raycast", []], ["assistant", "Got it.", []],
    ]);
    expect(view.conversation).toMatchObject({ provider: "anthropic", model: null });
  });
});

describe("pinning", () => {
  test("a new conversation records the provider and model, and a later message cannot move it", async () => {
    const { app, layoutId } = await optionOptionApp();
    const orClient = { apiKey: null, authToken: "k", baseURL: "https://openrouter.ai/api" };
    const first = await sendMessage(app, layoutId, { message: "hi", model: anthropicModel(fakeAnthropic([{ blocks: [{ text: "a" }] }], orClient).client, { provider: "openrouter" }) });
    expect(findConversation(app.db, first.conversationId)).toMatchObject({ provider: "openrouter", model: "anthropic/claude-opus-5.5" });

    const direct = anthropicModel(fakeAnthropic([{ blocks: [{ text: "b" }] }]).client);
    const err = await sendMessage(app, layoutId, { message: "again", conversationId: first.conversationId, model: direct }).catch((e) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(err.message).toContain("started on openrouter");
    const viaFlag = await sendMessage(app, layoutId, { message: "again", conversationId: first.conversationId, provider: "anthropic" }).catch((e) => e);
    expect(viaFlag).toBeInstanceOf(UsageError);
    // Nothing was stored for the refused message.
    expect(listMessages(app.db, first.conversationId)).toHaveLength(2);
  });

  test("a continued conversation keeps its own model even when the config names another", async () => {
    const { app, layoutId } = await optionOptionApp();
    const orClient = { apiKey: null, authToken: "k", baseURL: "https://openrouter.ai/api" };
    const first = await sendMessage(app, layoutId, {
      message: "hi", model: anthropicModel(fakeAnthropic([{ blocks: [{ text: "a" }] }], orClient).client, { provider: "openrouter", model: "anthropic/claude-sonnet-5.5" }),
    });
    expect(findConversation(app.db, first.conversationId)?.model).toBe("anthropic/claude-sonnet-5.5");
  });

  test("a turn stores neutral blocks that a second turn replays unchanged", async () => {
    const { app, layoutId } = await optionOptionApp();
    const fake = fakeAnthropic([
      { blocks: [{ tool: "get_layout", input: { layers: ["layer-0"] } }] },
      { blocks: [{ text: "Which app?" }] },
      { blocks: [{ text: "ok" }] },
    ]);
    const model = anthropicModel(fake.client);
    const first = await sendMessage(app, layoutId, { message: "Option is on S", model });
    const stored = listMessages(app.db, first.conversationId);
    expect(stored[1]?.content[0]).toMatchObject({ type: "tool_use", name: "get_layout", id: expect.any(String), input: { layers: ["layer-0"] } });
    expect(stored[2]?.content[0]).toMatchObject({ type: "tool_result", content: expect.any(String) });

    await sendMessage(app, layoutId, { message: "Raycast", conversationId: first.conversationId, model });
    const replayed = fake.requests[2]!.body.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    expect(replayed[1]?.content[0]).toMatchObject({ type: "tool_use", name: "get_layout", input: { layers: ["layer-0"] } });
    expect(replayed[2]?.content[0]).toMatchObject({ type: "tool_result", tool_use_id: (stored[1]?.content[0] as unknown as { id: string }).id });
  });
});
