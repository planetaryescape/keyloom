import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { ModelError, UsageError, sendMessage, showConversation } from "../../src/app/index.ts";
import { listMessages } from "../../src/persistence/conversations.ts";
import { withoutCredentials } from "../helpers/no-credentials.ts";
import { fakeAnthropic, type ScriptStep } from "../helpers/fake-anthropic.ts";
import { draft } from "../helpers/ops.ts";
import { optionOptionApp } from "../helpers/option-option.ts";

const run = async (script: ScriptStep[], opts: { message?: string; maxIterations?: number } = {}) => {
  const ctx = await optionOptionApp();
  const fake = fakeAnthropic(script);
  const model = anthropicModel(fake.client);
  const outcome = await sendMessage(ctx.app, ctx.layoutId, {
    message: opts.message ?? "Option is on S", model, ...(opts.maxIterations ? { maxIterations: opts.maxIterations } : {}),
  });
  return { ...ctx, ...fake, outcome };
};

const getLayout: ScriptStep = { blocks: [{ tool: "get_layout", input: { layers: ["layer-0"] } }] };
const invalidAlt = {
  alternatives: [{ title: "Nope", ops: [{ op: "setBinding", at: { layerId: "layer-2", position: 30 }, binding: { kind: "key", code: "OPTION" } }], explanation: "x", tradeoffs: { gains: [], costs: [] }, decisionDraft: draft() }],
};

describe("how a turn ends", () => {
  test("a refusal is reported, and the refused reply is not kept to poison the next message", async () => {
    const { outcome, app, layoutId } = await run([{ blocks: [], stop: "refusal" }]);
    expect(outcome.status).toBe("refused");
    expect(outcome.text).toBe("");
    const view = showConversation(app, outcome.conversationId);
    expect(view.messages.map((m) => m.role)).toEqual(["user"]);
    // The conversation still works afterwards, and the two user turns are sent as one.
    const fake = fakeAnthropic([{ blocks: [{ text: "ok" }] }]);
    await sendMessage(app, layoutId, { message: "again", conversationId: outcome.conversationId, model: anthropicModel(fake.client) });
    expect(fake.requests[0]?.body.messages).toHaveLength(1);
    expect(fake.requests[0]?.body.messages[0].content).toHaveLength(2);
  });

  test("max_tokens keeps the cut-off text so BK sees what the model said", async () => {
    const { outcome } = await run([{ blocks: [{ text: "Half a thou" }], stop: "max_tokens" }]);
    expect(outcome.status).toBe("truncated");
    expect(outcome.text).toBe("Half a thou");
  });

  test("max_tokens in the middle of a tool call drops that call, since it could never be answered", async () => {
    const { outcome, app } = await run([{ blocks: [{ tool: "get_layout", input: { layers: ["lay"] } }], stop: "max_tokens" }]);
    expect(outcome.status).toBe("truncated");
    expect(listMessages(app.db, outcome.conversationId).map((m) => m.role)).toEqual(["user"]);
  });

  test("the iteration limit stops a model that keeps calling tools, and says so", async () => {
    const { outcome, requests } = await run([getLayout, getLayout, getLayout, getLayout], { maxIterations: 2 });
    expect(outcome.status).toBe("iteration_limit");
    expect(requests).toHaveLength(2);
    expect(outcome.iterations).toBe(2);
  });

  test("after three proposals with nothing valid the tool tells the model to stop and explain", async () => {
    const propose = { blocks: [{ tool: "propose_changes", input: invalidAlt }] };
    const { outcome, requests, app } = await run([
      propose, propose, propose,
      (seen) => {
        expect(seen.toolResults[0]).toContain("Stop proposing");
        return { blocks: [{ tool: "propose_changes", input: invalidAlt }] };
      },
      (seen) => {
        expect(seen.toolResults[0]).toContain("Stop proposing");
        expect(seen.toolResults[0]).not.toContain("INVALID");
        return { blocks: [{ text: "I could not make this valid." }] };
      },
    ]);
    expect(requests).toHaveLength(5);
    expect(outcome.proposals).toEqual([]);
    expect(outcome.text).toBe("I could not make this valid.");
    const log = readFileSync(join(app.dataDir, "logs", "keyloom.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log[0].validationFailures).toHaveLength(3);
    expect(log[0].validationFailures[0].codes).toContain("firmware_unsupported");
  });

  test("a malformed tool input becomes an error result the model can read", async () => {
    const { outcome } = await run([
      { blocks: [{ tool: "find_function", input: { function: 7 } }] },
      (seen) => {
        expect(seen.toolResults[0]).toContain("invalid input for find_function");
        return { blocks: [{ text: "sorry" }] };
      },
    ]);
    expect(outcome.text).toBe("sorry");
  });
});

describe("the per-turn log", () => {
  test("records model, tokens, tool calls, duration and stop reason, without message text", async () => {
    const { app, outcome } = await run([
      { blocks: [{ tool: "get_layout", input: {} }], usage: { input: 1000, output: 200 } },
      { blocks: [{ text: "Which app?" }], usage: { input: 1500, output: 40 } },
    ], { message: "SECRET-TEXT" });
    const lines = readFileSync(join(app.dataDir, "logs", "keyloom.log"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? "");
    expect(entry).toMatchObject({
      event: "agent_turn", conversationId: outcome.conversationId, model: "claude-opus-5-5", effort: "medium",
      usage: { inputTokens: 2500, outputTokens: 240 }, stopReason: "end_turn", status: "complete", iterations: 2,
    });
    expect(entry.toolCalls).toEqual([{ name: "get_layout", durationMs: expect.any(Number), ok: true }]);
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    expect(entry.messageIds).toHaveLength(4);
    expect(lines[0]).not.toContain("SECRET-TEXT");
    expect(lines[0]).not.toContain("test-key");
  });
});

describe("failures before and during the model call", () => {
  test("a missing API key is a ModelError and stores nothing", async () => {
    const { app, layoutId } = await optionOptionApp();
    await withoutCredentials(async () => {
      const err = await sendMessage(app, layoutId, { message: "hi" }).catch((e) => e);
      expect(err).toBeInstanceOf(ModelError);
      expect(err.kind).toBe("missing_key");
      expect(app.db.query("SELECT COUNT(*) AS n FROM conversations").get()).toEqual({ n: 0 });
    });
  });

  test("a 401 from the API is a ModelError of kind auth, and BK's message is kept", async () => {
    const { app, layoutId } = await optionOptionApp();
    const fake = fakeAnthropic([{ blocks: [], error: { status: 401, message: "invalid x-api-key" } }]);
    const err = await sendMessage(app, layoutId, { message: "hi", model: anthropicModel(fake.client) }).catch((e) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err.kind).toBe("auth");
    expect(app.db.query("SELECT COUNT(*) AS n FROM messages").get()).toEqual({ n: 1 });
  });

  test("an empty message and a position off the board are usage errors", async () => {
    const { app, layoutId } = await optionOptionApp();
    const fake = fakeAnthropic([]);
    const model = anthropicModel(fake.client);
    await expect(sendMessage(app, layoutId, { message: "  ", model })).rejects.toBeInstanceOf(UsageError);
    await expect(sendMessage(app, layoutId, { message: "x", model, selection: { layer: "layer-0", positions: [999] } })).rejects.toBeInstanceOf(UsageError);
  });

  test("a selection is stored with the message and shown to the model", async () => {
    const { app, layoutId, requests } = await run([{ blocks: [{ text: "ok" }] }]).then(async (r) => {
      const fake = fakeAnthropic([{ blocks: [{ text: "ok" }] }]);
      await sendMessage(r.app, r.layoutId, { message: "this key", selection: { layer: "layer-0", positions: [31, 30] }, model: anthropicModel(fake.client) });
      return { ...r, requests: fake.requests };
    });
    expect(requests[0]?.body.messages[0].content[0].text).toStartWith("Selected on Layer 0 (layer id layer-0): S hold ⌥ (left ring, home row) at position 30; D (left middle, home row) at position 31\n\nthis key");
    const conv = app.db.query("SELECT id FROM conversations ORDER BY created_at DESC LIMIT 1").get() as { id: string };
    expect(showConversation(app, conv.id).messages[0]?.selection).toEqual({ layerId: "layer-0", positions: [30, 31] });
    expect(layoutId).toBeTruthy();
  });

  test("an unapplied draft goes to the model with the message, and the bubble shows only what was typed (D-317)", async () => {
    const { app } = await run([{ blocks: [{ text: "ok" }] }]);
    const layoutId = (app.db.query("SELECT id FROM layouts LIMIT 1").get() as { id: string }).id;
    const fake = fakeAnthropic([{ blocks: [{ text: "ok" }] }]);
    const drafts = [{ layerId: "layer-0", position: 30, binding: { kind: "key" as const, code: "Q" } }];
    await sendMessage(app, layoutId, { message: "is this better?", drafts, model: anthropicModel(fake.client) });
    const sent = fake.requests[0]?.body.messages[0].content[0].text as string;
    expect(sent).toStartWith("Unapplied draft on Layer 0 (layer id layer-0), S hold ⌥ (left ring, home row) at position 30: would become Q");
    expect(sent).toEndWith("\n\nis this better?");
    const conv = app.db.query("SELECT id FROM conversations ORDER BY created_at DESC LIMIT 1").get() as { id: string };
    expect(showConversation(app, conv.id).messages[0]?.text).toBe("is this better?");
    // A draft for a position the board doesn't have is refused, as a selection's is.
    await expect(sendMessage(app, layoutId, { message: "x", drafts: [{ ...drafts[0]!, position: 999 }], model: anthropicModel(fakeAnthropic([]).client) })).rejects.toBeInstanceOf(UsageError);
  });
});
