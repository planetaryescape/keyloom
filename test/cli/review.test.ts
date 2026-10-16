// `keyloom review` (D-340): the stored review in plain words and in JSON, and --run making the head's review with a scripted model.
import { describe, expect, test } from "bun:test";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { runCli } from "../../src/cli/main.ts";
import type { Io } from "../../src/cli/output.ts";
import { fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { withoutCredentials } from "../helpers/no-credentials.ts";
import { optionOptionApp } from "../helpers/option-option.ts";
import { finished, proposeStep, savedId, submit } from "../helpers/review-world.ts";

async function cli(args: string[], deps: Parameters<typeof runCli>[2] = {}) {
  let out = "";
  let err = "";
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: false };
  return { code: await runCli(args, io, deps), out, err };
}

describe("keyloom review", () => {
  test("before any review it says how to make one", async () => {
    const { dir } = await optionOptionApp();
    const r = await cli(["review", "bk", "--format", "table", "--data-dir", dir]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("No review of bk yet. Make one with: keyloom review bk --run");
    const json = JSON.parse((await cli(["review", "bk", "--json", "--data-dir", dir])).out);
    expect(json).toMatchObject({ schema_version: 1, stale: false, review: null });
  });

  test("--run with no model provider still gives the checks, in words, and says what is missing", async () => {
    const { dir } = await optionOptionApp();
    const r = await withoutCredentials(() => cli(["review", "bk", "--run", "--format", "table", "--data-dir", dir]));
    expect(r.code).toBe(0);
    expect(r.out).toContain("bk: 1 hint");
    expect(r.out).toContain("2 keys do nothing on Layer 0");
    expect(r.out).toContain("keyloom's own look needs a model: No model provider is set up. Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY, or sign in with `codex login`.");
    expect(r.out).toContain("6 layers, 72 keys and 8 combos checked");
  });

  test("--run with the agent lists its suggestion with the change set to look at, and --json is the same review", async () => {
    const { dir } = await optionOptionApp();
    const fake = fakeAnthropic([
      proposeStep,
      (seen) => submit([{ kind: "suggestion", code: "empty-key-use", title: "Use an empty key", body: "{key:layer-0:33} does nothing on {layer:layer-0}.", keys: [{ layerId: "layer-0", position: 33 }], proposalId: savedId(seen.toolResults) }]),
      finished,
    ]);
    const table = await cli(["review", "bk", "--run", "--format", "table", "--data-dir", dir], { model: anthropicModel(fake.client) });
    expect(table.out).toContain("bk: 1 suggestion, 1 hint");
    expect(table.out).toMatch(/Suggestions\n {2}Use an empty key {2}\(keyloom\)\n {4}blank \(.*Layer 0\) does nothing on Layer 0\./s);
    expect(table.out).toMatch(/Proposed change: cs_\w+\. See it with: keyloom change show cs_/);
    expect(table.out).toContain("keyloom looked it over.");

    // The second run is the stored review; the model is not asked again.
    const json = JSON.parse((await cli(["review", "bk", "--json", "--data-dir", dir], { model: anthropicModel(fake.client) })).out);
    expect(fake.requests).toHaveLength(3);
    expect(json).toMatchObject({ schema_version: 1, stale: false, review: { trigger: "manual", ai: { status: "done" }, checks: { status: "done" } } });
    expect(json.review.items.map((i: { source: string; kind: string }) => `${i.source}:${i.kind}`)).toEqual(["check:hint", "agent:suggestion"]);
    expect(json.review.items[1]).toMatchObject({ proposal_id: expect.stringMatching(/^cs_/), keys: [{ layer_id: "layer-0", position: 33 }], dismissed_at: null });
  });

  test("--force goes with --run", async () => {
    const { dir } = await optionOptionApp();
    expect((await cli(["review", "bk", "--force", "--data-dir", dir])).code).toBe(2);
  });
});
