// The Anthropic adapter on its two addresses (D-107), the credit-balance error (S19) and how the
// app picks a provider (19#choosing-a-provider). No network: the SDK's own fetch is scripted.
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { anthropicModel, classifyModelError, openRouterClientFromEnv } from "../../src/agent/anthropic-model.ts";
import { chooseProvider, credentialedProviders, defaultAgentModel } from "../../src/app/chat-model.ts";
import { ModelError, UsageError, sendMessage } from "../../src/app/index.ts";
import { fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { optionOptionApp } from "../helpers/option-option.ts";
import { tempDir } from "../helpers/tmp.ts";

const request = { system: "s", messages: [{ role: "user" as const, content: [{ type: "text", text: "hi" }] }], tools: [], maxIterations: 3 };

describe("OpenRouter through the Anthropic adapter", () => {
  test("sends a bearer token to OpenRouter's model ID without the Anthropic-only fallback fields", async () => {
    const fake = fakeAnthropic([{ blocks: [{ text: "hi" }], usage: { input: 10, output: 5, cost: 0.0123 } }], { apiKey: null, authToken: "or-key", baseURL: "https://openrouter.ai/api" });
    const model = anthropicModel(fake.client, { provider: "openrouter" });
    const result = await model.run(request);

    expect(model).toMatchObject({ provider: "openrouter", model: "anthropic/claude-opus-5.5" });
    const seen = fake.requests[0]!;
    expect(seen.url).toStartWith("https://openrouter.ai/api/v1/messages");
    expect(seen.headers.get("authorization")).toBe("Bearer or-key");
    expect(seen.headers.get("x-api-key")).toBeNull();
    expect(seen.body.model).toBe("anthropic/claude-opus-5.5");
    expect(seen.body.fallbacks).toBeUndefined();
    expect(seen.headers.get("anthropic-beta") ?? "").not.toContain("fallback");
    expect(seen.body.cache_control).toEqual({ type: "ephemeral" });
    expect(seen.body.thinking).toEqual({ type: "adaptive" });
    expect(result.costUsd).toBeCloseTo(0.0123);
  });

  test("the direct API keeps the fallback beta and reports no cost of its own", async () => {
    const fake = fakeAnthropic([{ blocks: [{ text: "hi" }] }]);
    const result = await anthropicModel(fake.client).run(request);
    expect(fake.requests[0]?.body.fallbacks).toBe("default");
    expect(result.costUsd).toBeUndefined();
  });

  test("a turn that makes two requests adds up the cost of both", async () => {
    const tool = { name: "t", description: "d", inputSchema: (await import("zod")).z.object({}), run: () => "ok" };
    const fake = fakeAnthropic([
      { blocks: [{ tool: "t", input: {} }], usage: { input: 1, output: 1, cost: 0.01 } },
      { blocks: [{ text: "done" }], usage: { input: 1, output: 1, cost: 0.02 } },
    ], { apiKey: null, authToken: "k", baseURL: "https://openrouter.ai/api" });
    const result = await anthropicModel(fake.client, { provider: "openrouter" }).run({ ...request, tools: [tool] });
    expect(result.iterations).toBe(2);
    expect(result.costUsd).toBeCloseTo(0.03);
  });

  test("openRouterClientFromEnv reads only OPENROUTER_API_KEY", () => {
    expect(openRouterClientFromEnv({})).toBeNull();
    expect(openRouterClientFromEnv({ ANTHROPIC_API_KEY: "a" })).toBeNull();
    expect(openRouterClientFromEnv({ OPENROUTER_API_KEY: " k " })?.baseURL).toBe("https://openrouter.ai/api");
  });
});

describe("running out of credits", () => {
  const errorKind = async (status: number, message: string, provider: "anthropic" | "openrouter") => {
    const fake = fakeAnthropic([{ blocks: [], error: { status, message } }]);
    const err = await anthropicModel(fake.client, { provider }).run(request).catch((e) => e);
    return classifyModelError(err, provider);
  };

  test("Anthropic's 400 about the credit balance is no_credits, not a generic request error", async () => {
    const known = await errorKind(400, "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.", "anthropic");
    expect(known).toMatchObject({ kind: "no_credits" });
    expect(known?.message).toContain("Anthropic");
  });

  test("OpenRouter's 402 is no_credits and names OpenRouter", async () => {
    const known = await errorKind(402, "Insufficient credits", "openrouter");
    expect(known).toMatchObject({ kind: "no_credits" });
    expect(known?.message).toContain("openrouter.ai/credits");
  });

  test("other 400s stay request errors, and a 401 names the provider's own variable", async () => {
    expect(await errorKind(400, "max_tokens must be positive", "anthropic")).toMatchObject({ kind: "request" });
    expect(await errorKind(401, "no auth", "openrouter")).toMatchObject({ kind: "auth", message: expect.stringContaining("OPENROUTER_API_KEY") });
  });

  test("the app turns it into a ModelError the chat can show", async () => {
    const { app, layoutId } = await optionOptionApp();
    const fake = fakeAnthropic([{ blocks: [], error: { status: 402, message: "Insufficient credits" } }]);
    const err = await sendMessage(app, layoutId, { message: "hi", model: anthropicModel(fake.client, { provider: "openrouter" }) }).catch((e) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err.kind).toBe("no_credits");
  });
});

describe("choosing the provider", () => {
  const keys = { ANTHROPIC_API_KEY: "a", OPENROUTER_API_KEY: "o" };

  test("with no flag, variable or config the first provider with a credential wins", () => {
    expect(chooseProvider({}, {}, keys)).toBe("anthropic");
    expect(chooseProvider({}, {}, { OPENROUTER_API_KEY: "o" })).toBe("openrouter");
    expect(credentialedProviders({ OPENROUTER_API_KEY: "  " })).toEqual([]);
  });

  test("the flag beats KEYLOOM_PROVIDER, which beats the config, which beats the default", () => {
    expect(chooseProvider({ provider: "openrouter" }, { provider: "codex" }, { ...keys, KEYLOOM_PROVIDER: "anthropic" })).toBe("openrouter");
    expect(chooseProvider({}, { provider: "openrouter" }, { ...keys, KEYLOOM_PROVIDER: "anthropic" })).toBe("anthropic");
    expect(chooseProvider({}, { provider: "openrouter" }, keys)).toBe("openrouter");
  });

  test("a bad KEYLOOM_PROVIDER is a usage error and nothing configured is a missing_key ModelError", () => {
    expect(() => chooseProvider({}, {}, { KEYLOOM_PROVIDER: "openai" })).toThrow(UsageError);
    const err = (() => { try { chooseProvider({}, {}, {}); } catch (e) { return e; } })();
    expect(err).toBeInstanceOf(ModelError);
    expect((err as ModelError).kind).toBe("missing_key");
  });

  test("the data directory's config picks the provider and model, and a malformed one names the file", () => {
    const dir = tempDir("keyloom-config-");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ agent: { provider: "openrouter", model: "anthropic/claude-sonnet-5.5", effort: "high" } }));
    const model = defaultAgentModel(dir, {}, keys);
    expect(model).toMatchObject({ provider: "openrouter", model: "anthropic/claude-sonnet-5.5", effort: "high" });

    // The config's model belongs to the config's provider; --provider anthropic must not get an OpenRouter ID.
    expect(defaultAgentModel(dir, { provider: "anthropic" }, keys)).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5" });

    writeFileSync(join(dir, "config.json"), "{ nope");
    expect(() => defaultAgentModel(dir, {}, keys)).toThrow(/config\.json is not valid JSON/);
    writeFileSync(join(dir, "config.json"), JSON.stringify({ agent: { provider: "gemini" } }));
    expect(() => defaultAgentModel(dir, {}, keys)).toThrow(/not a valid keyloom config/);
  });

  test("a missing credential for the chosen provider names that provider's variable", () => {
    const dir = tempDir("keyloom-config-");
    expect(() => defaultAgentModel(dir, { provider: "openrouter" }, { ANTHROPIC_API_KEY: "a" })).toThrow(/OPENROUTER_API_KEY is not set/);
  });
});
