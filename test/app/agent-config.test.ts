import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readAgentConfig, writeAgentConfig } from "../../src/app/agent-config.ts";
import { tempDir } from "../helpers/tmp.ts";

describe("agent config", () => {
  test("missing file returns empty config", () => {
    expect(readAgentConfig(tempDir())).toEqual({});
  });

  test("saving a provider preserves server settings and existing effort", () => {
    const dir = tempDir();
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ server: { port: 4000 }, agent: { provider: "anthropic", model: "old", effort: "high" } }));
    writeAgentConfig(dir, { provider: "openrouter", model: "new" });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      server: { port: 4000 }, agent: { provider: "openrouter", model: "new", effort: "high" },
    });
    expect(readAgentConfig(dir)).toEqual({ provider: "openrouter", model: "new", effort: "high" });
  });
});
