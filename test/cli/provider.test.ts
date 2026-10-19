import { describe, expect, test } from "bun:test";
import { runCli } from "../../src/cli/main.ts";
import type { Io } from "../../src/cli/output.ts";
import { optionOptionApp } from "../helpers/option-option.ts";

async function cli(args: string[]) {
  let out = "";
  let err = "";
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: false };
  return { code: await runCli(args, io), out, err };
}

describe("keyloom provider commands", () => {
  test("provider status outputs active provider and provider list", async () => {
    const { dir } = await optionOptionApp();
    const r = await cli(["provider", "status", "--format", "table", "--data-dir", dir]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Available providers:");
    expect(r.out).toContain("anthropic");
    expect(r.out).toContain("openrouter");
    expect(r.out).toContain("codex");

    const json = JSON.parse((await cli(["provider", "status", "--json", "--data-dir", dir])).out);
    expect(json.schema_version).toBe(1);
    expect(json.providers).toHaveLength(3);
  });

  test("provider use sets provider and model in config.json", async () => {
    const { dir } = await optionOptionApp();
    const use = await cli(["provider", "use", "openrouter", "--model", "anthropic/claude-3.5-sonnet", "--format", "table", "--data-dir", dir]);
    expect(use.code).toBe(0);
    expect(use.out).toContain("Saved openrouter (model: anthropic/claude-3.5-sonnet) as default provider in config.json.");

    const json = JSON.parse((await cli(["provider", "status", "--json", "--data-dir", dir])).out);
    expect(json.active?.provider).toBe("openrouter");
    expect(json.active?.model).toBe("anthropic/claude-3.5-sonnet");
  });

  test("provider use with invalid provider returns exit code 2", async () => {
    const { dir } = await optionOptionApp();
    const use = await cli(["provider", "use", "nonexistent-provider", "--data-dir", dir]);
    expect(use.code).toBe(2);
    expect(use.err).toContain("nonexistent-provider");
    expect(use.err).toContain("choose one of");
  });
});
