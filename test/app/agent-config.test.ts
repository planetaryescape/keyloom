import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readAgentConfig, writeAgentConfig } from "../../src/app/agent-config.ts";

describe("agent config", () => {
  const tmp = `/tmp/keyloom-test-agent-config-${Date.now()}`;
  mkdirSync(tmp, { recursive: true });

  test("missing file returns empty config", () => {
    expect(readAgentConfig(tmp)).toEqual({});
  });

  test("valid config with server.port and agent settings parses cleanly", () => {
    writeFileSync(join(tmp, "config.json"), JSON.stringify({
      server: { port: 4000 },
      agent: { provider: "anthropic", model: "claude-opus-5-5", effort: "high" },
    }));
    expect(readAgentConfig(tmp)).toEqual({
      provider: "anthropic",
      model: "claude-opus-5-5",
      effort: "high",
    });
  });

  test("writeAgentConfig preserves valid structure", () => {
    writeAgentConfig(tmp, { provider: "openrouter", model: "anthropic/claude-3.5-sonnet" });
    expect(readAgentConfig(tmp)).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-3.5-sonnet",
      effort: "high",
    });
    rmSync(tmp, { recursive: true, force: true });
  });
});
