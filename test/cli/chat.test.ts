import { describe, expect, test } from "bun:test";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { runCli } from "../../src/cli/main.ts";
import { parseSelect } from "../../src/cli/commands/chat.ts";
import type { Io } from "../../src/cli/output.ts";
import { type ScriptStep, fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { optionOptionApp } from "../helpers/option-option.ts";
import { withoutCredentials } from "../helpers/no-credentials.ts";
import { draft } from "../helpers/ops.ts";

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
