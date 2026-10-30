import { describe, expect, test } from "bun:test";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { runCli } from "../../src/cli/main.ts";
import { parseSelect } from "../../src/cli/commands/chat.ts";
import type { Io } from "../../src/cli/output.ts";
import { type ScriptStep, fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { optionOptionApp } from "../helpers/option-option.ts";
import { withoutCredentials } from "../helpers/no-credentials.ts";
import { draft } from "../helpers/ops.ts";
import { importLayout, openApp, sendMessage } from "../../src/app/index.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { STYLE_FIXTURE } from "../helpers/zmk.ts";
import { tempDir } from "../helpers/tmp.ts";
import { insertConversation, insertMessage } from "../../src/persistence/conversations.ts";

async function cli(args: string[], deps: Parameters<typeof runCli>[2] = {}) {
  let out = "";
  let err = "";
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: false };
  return { code: await runCli(args, io, deps), out, err };
}

const propose = {
  alternatives: [{
    title: "Plain Option on layer 2",
    ops: [{ op: "setBinding", at: { layerId: "layer-2", position: 30 }, binding: { kind: "modifier", mods: ["LALT"] } }],
    explanation: "Hold layer 2 with your right hand, then tap S twice.",
    tradeoffs: { gains: ["Option-Option works"], costs: ["One more layer to remember"] },
    decisionDraft: draft(),
  }],
};
const script: ScriptStep[] = [
  { blocks: [{ text: "Here is " }, { tool: "propose_changes", input: propose }] },
  { blocks: [{ text: "Use layer 2." }] },
];

describe("keyloom chat", () => {
  test("--message streams the reply, prints the proposal and how to apply it", async () => {
    const { dir } = await optionOptionApp();
    const fake = fakeAnthropic(script);
    const r = await cli(["chat", "bk", "--message", "Option is on S", "--format", "table", "--data-dir", dir], { model: anthropicModel(fake.client) });
    expect(r.code).toBe(0);
    expect(r.out).toContain("Here is Use layer 2.");
    expect(r.out).toMatch(/cs_[0-9A-Z]{26}  Plain Option on layer 2/);
    expect(r.out).toContain("- Option-Option works");
    expect(r.out).toContain("keyloom change apply cs_");
    expect(r.err).toContain("[propose_changes]");
    expect(r.err).toMatch(/conversation conv_/);
  });

  test("--format json prints one final object and nothing else", async () => {
    const { dir } = await optionOptionApp();
    const r = await cli(["chat", "bk", "--message", "x", "--format", "json", "--data-dir", dir], { model: anthropicModel(fakeAnthropic(script).client) });
    expect(r.code).toBe(0);
    const body = JSON.parse(r.out);
    expect(body).toMatchObject({
      schema_version: 1, status: "complete", model: "claude-opus-5-5",
      proposals: [{ title: "Plain Option on layer 2", validation: { ok: true } }],
    });
    expect(body.conversation_id).toMatch(/^conv_/);
    expect(body.message_ids.length).toBe(4);
    expect(body.proposals[0].change_set_id).toMatch(/^cs_/);
    expect(body.usage.input_tokens).toBeGreaterThan(0);
  });

  test("JSON keeps reported cost and usage, and saved conversation JSON retains the same facts", async () => {
    const { app, dir } = await optionOptionApp();
    try {
      const usage = { inputTokens: 123, outputTokens: 45, cacheReadTokens: 67, cacheCreationTokens: 8 };
      const model = { provider: "openrouter" as const, model: "synthetic", effort: "medium", classifyError: () => null, run: async () => ({ messages: [{ role: "assistant" as const, content: [{ type: "text" as const, text: "Done." }] }], stopReason: "end_turn", iterations: 1, usage, costUsd: 0.0123 }) };
      const sent = await cli(["chat", "bk", "--message", "Synthetic", "--format", "json", "--data-dir", dir], { model });
      expect(sent.code).toBe(0);
      const body = JSON.parse(sent.out);
      expect(body).toMatchObject({ cost_usd: 0.0123, usage: { input_tokens: 123, output_tokens: 45, cache_read_input_tokens: 67, cache_creation_input_tokens: 8 } });
      const saved = await cli(["conversations", "show", body.conversation_id, "--format", "json", "--data-dir", dir]);
      expect(saved.code).toBe(0);
      expect(JSON.parse(saved.out).presentations[0].accounting).toEqual({ provider: "openrouter", model: "synthetic", usage, costUsd: 0.0123 });
    } finally { app.db.close(); }
  });

  test("a config the agent made is named with its board and id, in the table and additively in JSON", async () => {
    const dir = tempDir();
    const app = openApp({ dataDir: dir });
    await importLayout(app, { board: "moergo/glove80", source: STYLE_FIXTURE, name: "my-glove80" });
    await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "my-moonlander" });
    app.db.close();
    const steps = (): ScriptStep[] => [
      { blocks: [{ tool: "put_config", input: { from: "my-glove80", board: "foostan/corne" } }] },
      { blocks: [{ text: "Copied your Glove80 setup onto the Corne." }] },
    ];
    const table = await cli(["chat", "my-moonlander", "--message", "put my glove80 on my corne", "--format", "table", "--data-dir", dir], { model: anthropicModel(fakeAnthropic(steps()).client) });
    expect(table.code).toBe(0);
    expect(table.out).toMatch(/made config "my-glove80 on Corne" \(\S+\) on the Corne/);
    expect(table.out).toContain("keyloom change list ");
    const json = await cli(["chat", "my-moonlander", "--message", "again", "--format", "json", "--data-dir", dir], { model: anthropicModel(fakeAnthropic([
      { blocks: [{ tool: "put_config", input: { from: "my-glove80", board: "foostan/corne", name: "second" } }] },
      { blocks: [{ text: "Done." }] },
    ]).client) });
    const body = JSON.parse(json.out);
    expect(body.configs_made).toEqual([{ id: expect.any(String), name: "second", board_id: "foostan/corne", board_name: "Corne" }]);
    const plain = await cli(["chat", "my-moonlander", "--message", "hi", "--format", "json", "--data-dir", dir], { model: anthropicModel(fakeAnthropic([{ blocks: [{ text: "Hi." }] }]).client) });
    expect(JSON.parse(plain.out).configs_made).toEqual([]);
  });

  test("the applying command from the output works", async () => {
    const { dir } = await optionOptionApp();
    const chat = await cli(["chat", "bk", "--message", "x", "--format", "json", "--data-dir", dir], { model: anthropicModel(fakeAnthropic(script).client) });
    const id = JSON.parse(chat.out).proposals[0].change_set_id;
    const applied = await cli(["change", "apply", id, "--format", "json", "--data-dir", dir]);
    expect(applied.code).toBe(0);
  });

  test("interactive mode keeps one conversation across lines and stops on an empty line", async () => {
    const { dir } = await optionOptionApp();
    const fake = fakeAnthropic([{ blocks: [{ text: "one" }] }, { blocks: [{ text: "two" }] }]);
    async function* lines() {
      yield "first";
      yield "second";
      yield "";
      yield "never read";
    }
    const r = await cli(["chat", "bk", "--data-dir", dir, "--format", "table"], { model: anthropicModel(fake.client), lines: lines() });
    expect(r.code).toBe(0);
    expect(r.out).toContain("one\n");
    expect(r.out).toContain("two\n");
    expect(fake.requests[1]?.body.messages).toHaveLength(3); // first, its answer, second
  });

  test("a missing API key exits 9 and names every way to set one up", async () => {
    const { dir } = await optionOptionApp();
    await withoutCredentials(async () => {
      const r = await cli(["chat", "bk", "--message", "hi", "--format", "table", "--data-dir", dir]);
      expect(r.code).toBe(9);
      expect(r.err).toContain("ANTHROPIC_API_KEY");
      expect(r.err).toContain("OPENROUTER_API_KEY");
      expect(r.err).toContain("codex login");
      const j = await cli(["chat", "bk", "--message", "hi", "--format", "json", "--data-dir", dir]);
      expect(JSON.parse(j.err)).toMatchObject({ error: { code: "missing_api_key" } });
    });
  });

  test("--provider names the credential that provider needs", async () => {
    const { dir } = await optionOptionApp();
    await withoutCredentials(async () => {
      const anthropic = await cli(["chat", "bk", "--message", "hi", "--provider", "anthropic", "--format", "table", "--data-dir", dir]);
      expect(anthropic.err).toContain("ANTHROPIC_API_KEY is not set");
      const openrouter = await cli(["chat", "bk", "--message", "hi", "--provider", "openrouter", "--format", "table", "--data-dir", dir]);
      expect(openrouter.code).toBe(9);
      expect(openrouter.err).toContain("OPENROUTER_API_KEY is not set");
      const typo = await cli(["chat", "bk", "--message", "hi", "--provider", "openai", "--format", "table", "--data-dir", dir]);
      expect(typo.code).toBe(2);
      expect(typo.err).toContain("anthropic, openrouter, codex");
    });
  });

  test("a refusal exits 9 after printing what happened", async () => {
    const { dir } = await optionOptionApp();
    const r = await cli(["chat", "bk", "--message", "x", "--format", "table", "--data-dir", dir], { model: anthropicModel(fakeAnthropic([{ blocks: [], stop: "refusal" }]).client) });
    expect(r.code).toBe(9);
    expect(r.err).toContain("declined");
  });

  test("conversations list shows the conversation", async () => {
    const { dir } = await optionOptionApp();
    await cli(["chat", "bk", "--message", "Option is on S", "--format", "json", "--data-dir", dir], { model: anthropicModel(fakeAnthropic(script).client) });
    const r = await cli(["conversations", "list", "bk", "--format", "json", "--data-dir", dir]);
    expect(JSON.parse(r.out).conversations).toMatchObject([{ title: "Option is on S" }]);
  });

  test("conversations show inspects the same saved work in JSON/table/ids without a model", async () => {
    const { app, dir, layoutId } = await optionOptionApp();
    const out = await sendMessage(app, layoutId, { message: "Inspect", model: anthropicModel(fakeAnthropic([{ blocks: [{ tool: "list_layouts", input: {} }] }, { blocks: [{ text: "Done." }] }]).client) });
    const args = ["conversations", "show", out.conversationId, "--data-dir", dir];
    const json = await cli([...args, "--format", "json"]);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.out)).toMatchObject({ schema_version: 1, presentations: [{ status: "completed", operations: [{ label: "List configs", status: "succeeded" }] }] });
    expect((await cli([...args, "--format", "table"])).out).toContain("List configs: succeeded");
    expect((await cli([...args, "--format", "ids"])).out.trim()).toBe(out.conversationId);
    const old = insertConversation(app.db, { layoutId, title: "Legacy" });
    insertMessage(app.db, { conversationId: old.id, role: "assistant", content: [{ type: "text", text: "Old answer" }] });
    const legacy = await cli(["conversations", "show", old.id, "--data-dir", dir, "--format", "table"]);
    expect(legacy.out).toContain("Working details unavailable for this older conversation.");
    expect((await cli(["conversations", "show", "conv_missing", "--data-dir", dir])).code).toBe(3);
    app.db.close();
  });

  test("--select parses layer and positions, and rejects nonsense", () => {
    expect(parseSelect("layer-0:29,30, 31")).toEqual({ layer: "layer-0", positions: [29, 30, 31] });
    expect(() => parseSelect("layer-0")).toThrow("--select must look like");
    expect(() => parseSelect("layer-0:a")).toThrow("--select must look like");
  });

  test("an unknown layout is exit 3", async () => {
    const { dir } = await optionOptionApp();
    const r = await cli(["chat", "nope", "--message", "x", "--data-dir", dir], { model: anthropicModel(fakeAnthropic([]).client) });
    expect(r.code).toBe(3);
  });
});

const copyScript: ScriptStep[] = [
  { blocks: [{ tool: "put_config", input: { from: "bk", board: "foostan/corne", name: "bk on Corne" } }] },
  { blocks: [{ text: "Adapted it on the Corne." }] },
];

describe("keyloom chat on a copy", () => {
  test("prints what came across once, with the first drops and their reasons, bounded", async () => {
    const { dir } = await optionOptionApp();
    const r = await cli(["chat", "bk", "--message", "Copy my setup onto my Corne", "--format", "table", "--data-dir", dir], { model: anthropicModel(fakeAnthropic(copyScript).client) });
    expect(r.code).toBe(0);
    expect(r.out).toContain("Moonlander -> Corne");
    expect(r.out).toMatch(/\d+ keys came across on \d+ layers(, \d+ of them nearest-place guesses)?/);
    // Once, on the copy's own reply.
    expect([...r.out.matchAll(/keys did not come across:/g)]).toHaveLength(1);
    const heading = r.out.match(/(\d+) keys did not come across:/);
    if (!heading) throw new Error("no drops heading");
    expect(r.out).toMatch(/^ {2}.+ \(.+\): (no key on the new board does this|the new board has no key in this place|every key it could take fits another key better|the source board gives this key no hand or finger)$/m);
    const dropped = Number(heading[1]);
    if (dropped > 8) expect(r.out).toContain(`and ${dropped - 8} more`);
    expect(r.out).toContain("adapting it continues in the new config's own conversation");
    expect(r.out).not.toContain("keys did not come across (");
  });

  test("--format json carries the same report and nothing else", async () => {
    const { dir } = await optionOptionApp();
    const r = await cli(["chat", "bk", "--message", "Copy my setup onto my Corne", "--format", "json", "--data-dir", dir], { model: anthropicModel(fakeAnthropic(copyScript).client) });
    expect(r.code).toBe(0);
    const body = JSON.parse(r.out);
    expect(body.transfer_report).toMatchObject({ kind: "transfer", sourceBoard: "Moonlander", destinationBoard: "Corne" });
    expect(body.transfer_report.mappedCount).toBeGreaterThan(0);
    expect(body.transfer_report.skippedCount).toBeGreaterThanOrEqual(body.transfer_report.skipped.length);
    expect(body.copy_source.conversation_id).toMatch(/^conv_/);
  });
});
