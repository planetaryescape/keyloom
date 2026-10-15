// The Anthropic adapter on its two addresses (D-107), the credit-balance error (S19) and how the
// app picks a provider (19#choosing-a-provider). No network: the SDK's own fetch is scripted.
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { anthropicModel, classifyModelError, openRouterClientFromEnv } from "../../src/agent/anthropic-model.ts";
import { NO_CODEX } from "../helpers/no-credentials.ts";
import { chooseNextProvider, chooseProvider, defaultAgentModel, keyedProviders, providerStatus } from "../../src/app/chat-model.ts";
import { ModelError, UsageError, sendMessage } from "../../src/app/index.ts";
import { fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { fakeCodex } from "../helpers/fake-codex.ts";
import { optionOptionApp } from "../helpers/option-option.ts";
import { tempDir } from "../helpers/tmp.ts";

const request = { system: "s", messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }], tools: [], maxIterations: 3 };

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
  // KEYLOOM_CODEX_BIN points at nothing, so none of these depend on whether the developer's codex is signed in.
  const base = { KEYLOOM_CODEX_BIN: NO_CODEX };
  const keys = { ...base, ANTHROPIC_API_KEY: "a", OPENROUTER_API_KEY: "o" };

  test("with no flag, variable or config the first provider with a credential wins", async () => {
    expect(await chooseProvider({}, {}, keys)).toBe("anthropic");
    expect(await chooseProvider({}, {}, { ...base, OPENROUTER_API_KEY: "o" })).toBe("openrouter");
    expect(keyedProviders({ OPENROUTER_API_KEY: "  " })).toEqual([]);
  });

  test("a signed-in codex is the last resort, and a key still beats it", async () => {
    const fake = fakeCodex({ loggedIn: true });
    expect(await chooseProvider({}, {}, { KEYLOOM_CODEX_BIN: fake.bin })).toBe("codex");
    expect(await chooseProvider({}, {}, { KEYLOOM_CODEX_BIN: fake.bin, OPENROUTER_API_KEY: "o" })).toBe("openrouter");
    expect(await chooseProvider({}, {}, { KEYLOOM_CODEX_BIN: fakeCodex({ loggedIn: false }).bin }).catch((e) => e)).toBeInstanceOf(ModelError);
    expect(await chooseProvider({}, {}, { CODEX_API_KEY: "c", KEYLOOM_CODEX_BIN: NO_CODEX })).toBe("codex");
  });

  test("the flag beats KEYLOOM_PROVIDER, which beats the config, which beats the default", async () => {
    expect(await chooseProvider({ provider: "openrouter" }, { provider: "codex" }, { ...keys, KEYLOOM_PROVIDER: "anthropic" })).toBe("openrouter");
    expect(await chooseProvider({}, { provider: "openrouter" }, { ...keys, KEYLOOM_PROVIDER: "anthropic" })).toBe("anthropic");
    expect(await chooseProvider({}, { provider: "openrouter" }, keys)).toBe("openrouter");
  });

  test("a bad KEYLOOM_PROVIDER is a usage error and nothing configured is a missing_key ModelError", async () => {
    expect(await chooseProvider({}, {}, { ...base, KEYLOOM_PROVIDER: "openai" }).catch((e) => e)).toBeInstanceOf(UsageError);
    const err = await chooseProvider({}, {}, base).catch((e) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err.kind).toBe("missing_key");
  });

  test("the data directory's config picks the provider and model, and a malformed one names the file", async () => {
    const dir = tempDir("keyloom-config-");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ agent: { provider: "openrouter", model: "anthropic/claude-sonnet-5.5", effort: "high" } }));
    expect(await defaultAgentModel(dir, {}, keys)).toMatchObject({ provider: "openrouter", model: "anthropic/claude-sonnet-5.5", effort: "high" });

    // The config's model belongs to the config's provider; --provider anthropic must not get an OpenRouter ID.
    expect(await defaultAgentModel(dir, { provider: "anthropic" }, keys)).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5" });

    writeFileSync(join(dir, "config.json"), "{ nope");
    await expect(defaultAgentModel(dir, {}, keys)).rejects.toThrow(/config\.json is not valid JSON/);
    writeFileSync(join(dir, "config.json"), JSON.stringify({ agent: { provider: "gemini" } }));
    await expect(defaultAgentModel(dir, {}, keys)).rejects.toThrow(/not a valid keyloom config/);
  });

  test("a missing credential for the chosen provider names that provider's variable or login", async () => {
    const dir = tempDir("keyloom-config-");
    await expect(defaultAgentModel(dir, { provider: "openrouter" }, { ...base, ANTHROPIC_API_KEY: "a" })).rejects.toThrow(/OPENROUTER_API_KEY is not set/);
    await expect(defaultAgentModel(dir, { provider: "codex" }, { KEYLOOM_CODEX_BIN: fakeCodex({ loggedIn: false }).bin })).rejects.toThrow(/codex login/);
    await expect(defaultAgentModel(dir, { provider: "codex" }, base)).rejects.toThrow(/not installed/);
  });
});

describe("provider status for the chat panel", () => {
  test("names the active provider and model, and which providers are ready", async () => {
    const status = await providerStatus(tempDir("keyloom-status-"), {}, { KEYLOOM_CODEX_BIN: NO_CODEX, OPENROUTER_API_KEY: "o" });
    expect(status.active).toEqual({ provider: "openrouter", model: "anthropic/claude-opus-5.5", effort: "medium" });
    expect(status.providers.map((p) => [p.id, p.ready])).toEqual([["anthropic", false], ["openrouter", true], ["codex", false]]);
  });

  test("with nothing set up there is no active provider and all three ways to set one up are listed", async () => {
    const status = await providerStatus(tempDir("keyloom-status-"), {}, { KEYLOOM_CODEX_BIN: NO_CODEX });
    expect(status.active).toBeNull();
    expect(status.providers.map((p) => p.command)).toEqual(["ANTHROPIC_API_KEY=<your key> keyloom serve", "OPENROUTER_API_KEY=<your key> keyloom serve", "codex login"]);
  });

  test("a signed-in codex shows as ready", async () => {
    const status = await providerStatus(tempDir("keyloom-status-"), {}, { KEYLOOM_CODEX_BIN: fakeCodex({ loggedIn: true }).bin });
    expect(status.active?.provider).toBe("codex");
    expect(status.providers.find((p) => p.id === "codex")?.ready).toBe(true);
  });
});

describe("choosing the provider from the web app", () => {
  const env = { KEYLOOM_CODEX_BIN: NO_CODEX, OPENROUTER_API_KEY: "o" };

  test("the choice is written to config.json, keeps the effort already there, and applies to the next conversation", async () => {
    const dir = tempDir("keyloom-pick-");
    writeFileSync(join(dir, "config.json"), JSON.stringify({ agent: { provider: "openrouter", model: "old/model", effort: "high" } }));
    const status = await chooseNextProvider(dir, { provider: "anthropic", model: "claude-test" }, {}, env);
    expect(JSON.parse(readFileSync(join(dir, "config.json"), "utf8"))).toEqual({ agent: { provider: "anthropic", model: "claude-test", effort: "high" } });
    expect(status.active).toEqual({ provider: "anthropic", model: "claude-test", effort: "high" });
    // A provider without a credential can still be chosen: the panel then says what it needs.
    expect(status.providers.find((p) => p.id === "anthropic")?.ready).toBe(false);
  });

  test("no model means that provider's default, and an earlier model for another provider is dropped", async () => {
    const dir = tempDir("keyloom-pick-");
    await chooseNextProvider(dir, { provider: "openrouter", model: "x/y" }, {}, env);
    const status = await chooseNextProvider(dir, { provider: "anthropic" }, {}, env);
    expect(status.active?.model).toBe("claude-opus-5-5");
    expect(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).agent).toEqual({ provider: "anthropic" });
  });

  test("a flag or KEYLOOM_PROVIDER outranks the file, and the status says so", async () => {
    const dir = tempDir("keyloom-pick-");
    expect((await providerStatus(dir, { provider: "openrouter" }, env)).lockedBy).toBe("--provider");
    expect((await providerStatus(dir, {}, { ...env, KEYLOOM_PROVIDER: "openrouter" })).lockedBy).toBe("KEYLOOM_PROVIDER");
    expect((await providerStatus(dir, {}, env)).lockedBy).toBeNull();
  });

  test("a config file keyloom can't read is reported and left as it was", async () => {
    const dir = tempDir("keyloom-pick-");
    writeFileSync(join(dir, "config.json"), "{ not json");
    await expect(chooseNextProvider(dir, { provider: "anthropic" }, {}, env)).rejects.toThrow(UsageError);
    expect(readFileSync(join(dir, "config.json"), "utf8")).toBe("{ not json");
  });
});

describe("the provider list", () => {
  // Persistence, the HTTP contract and the agent can't import one another (01#modules), so each keeps its own copy of the three IDs.
  test("is the same in the agent, the database check, the wire schema and the migration", async () => {
    const { PROVIDERS } = await import("../../src/agent/provider.ts");
    const { CONVERSATION_PROVIDERS } = await import("../../src/persistence/conversations.ts");
    const { ChatProviderIdSchema } = await import("../../src/api/http.ts");
    const { MIGRATIONS } = await import("../../src/persistence/migrations.ts");
    expect([...CONVERSATION_PROVIDERS]).toEqual([...PROVIDERS]);
    expect(ChatProviderIdSchema.options).toEqual([...PROVIDERS]);
    const sql = MIGRATIONS.find((m) => m.version === 7)?.sql ?? "";
    for (const p of PROVIDERS) expect(sql).toContain(`'${p}'`);
  });
});
