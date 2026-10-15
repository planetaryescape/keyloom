// The Anthropic implementation of AgentModel (D-031): the SDK's beta Tool Runner over zod tools,
// streaming, with adaptive thinking and an explicit effort. This is the only file that imports the SDK.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import {
  type AgentModel, type ContentBlock, type ModelErrorKind, type ModelMessage, type ModelTool, type Usage, addUsage, emptyUsage,
} from "./model.ts";
import { DEFAULT_MODELS } from "./provider.ts";

export type { ModelErrorKind } from "./model.ts";

/** 03#model-and-sdk. The ID is a config value (`agent.model`); this is its default. */
export const DEFAULT_MODEL = DEFAULT_MODELS.anthropic;
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export const DEFAULT_EFFORT: Effort = "medium";

// Room for thinking plus a proposal with three alternatives; streaming keeps a long reply from timing out.
const MAX_TOKENS = 16_000;

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * The tool as the API sees it. `strict` needs a schema in the structured-output subset, which the
 * SDK's transform produces (it moves unsupported keywords like minLength into the description).
 * zod still parses every input in `defineTool`, because streamed input is not validated by the API.
 */
function toRunnable(tool: ModelTool) {
  const base = betaZodTool({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    run: (args) => tool.run(args),
  });
  return {
    ...base,
    input_schema: transformJSONSchema(z.toJSONSchema(tool.inputSchema, { reused: "ref" })),
    strict: tool.strict ?? true,
    eager_input_streaming: true,
    // The runner would parse with zod before `run`; defineTool does it so a bad input is recorded and explained.
    parse: (raw: unknown) => raw,
  } as typeof base;
}

type RawUsage = {
  input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null;
  /** OpenRouter's charge in dollars, on the closing message_delta. */
  cost?: number | null;
};

const usageOf = (u: RawUsage): Usage => ({
  inputTokens: u.input_tokens ?? 0,
  outputTokens: u.output_tokens ?? 0,
  cacheReadTokens: u.cache_read_input_tokens ?? 0,
  cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
});

/** The two places this adapter runs: Anthropic's own API, and OpenRouter's Anthropic-compatible endpoint (D-107). */
export type AnthropicFamily = "anthropic" | "openrouter";

const PROVIDER_NAME: Record<AnthropicFamily, string> = { anthropic: "Anthropic", openrouter: "OpenRouter" };
const KEY_NAME: Record<AnthropicFamily, string> = { anthropic: "ANTHROPIC_API_KEY", openrouter: "OPENROUTER_API_KEY" };

export function anthropicModel(client: Anthropic, opts: { model?: string; effort?: Effort; provider?: AnthropicFamily } = {}): AgentModel {
  const provider = opts.provider ?? "anthropic";
  const model = opts.model ?? DEFAULT_MODELS[provider];
  const effort = opts.effort ?? DEFAULT_EFFORT;
  return {
    provider,
    model,
    effort,
    classifyError: (err) => classifyModelError(err, provider),
    async run(request) {
      const runner = client.beta.messages.toolRunner(
        {
          model,
          max_tokens: MAX_TOKENS,
          system: request.system,
          messages: request.messages as BetaMessageParam[],
          tools: request.tools.map(toRunnable),
          stream: true,
          max_iterations: request.maxIterations,
          // Opus 5.5 rejects forced tool_choice, so the system prompt names the tool to use instead.
          tool_choice: { type: "auto" },
          thinking: { type: "adaptive" },
          output_config: { effort },
          // Anthropic's server-side fallback is a beta of its own API. OpenRouter rejects `fallbacks: "default"`
          // (it wants an array, S19), and has its own routing, so only the direct API gets it.
          ...(provider === "anthropic" ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
          // Caches up to the last block, so a follow-up message re-reads the system prompt and history cheaply.
          cache_control: { type: "ephemeral" },
        },
        request.signal ? { signal: request.signal } : undefined,
      );

      let usage = emptyUsage();
      let costUsd: number | undefined;
      let iterations = 0;
      let stopReason: string | null = null;
      for await (const stream of runner) {
        if (request.onText) stream.on("text", (delta) => request.onText?.(delta));
        // The SDK's final message copies only the usage fields it knows, so OpenRouter's `cost` (sent in
        // the closing message_delta, S19) has to be read from the raw event.
        let cost: number | undefined;
        stream.on("streamEvent", (event) => {
          if (event.type !== "message_delta") return;
          const reported = (event.usage as RawUsage).cost;
          if (typeof reported === "number") cost = reported;
        });
        const message = await stream.finalMessage();
        iterations++;
        usage = addUsage(usage, usageOf(message.usage));
        if (cost !== undefined) costUsd = (costUsd ?? 0) + cost;
        stopReason = message.stop_reason;
      }
      // The runner's own copy of the conversation now holds the assistant turns and tool results it added.
      const added = runner.params.messages.slice(request.messages.length) as ModelMessage[];
      return { messages: added.map(toStored), stopReason: stopReason ?? "end_turn", iterations, usage, ...(costUsd === undefined ? {} : { costUsd }) };
    },
  };
}

/** A user turn's content may be a bare string in the SDK's types; storage keeps blocks. */
function toStored(m: { role: "user" | "assistant"; content: unknown }): ModelMessage {
  const content = typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content as ContentBlock[]);
  return { role: m.role, content };
}

// Anthropic reports an empty balance as a 400 whose text says so; OpenRouter uses 402 "Insufficient credits".
const NO_CREDITS = /credit balance is too low|insufficient credits|billing_error/i;

/** Maps an SDK failure to the few kinds BK acts on; null when it isn't a model API failure, so a bug stays a bug. */
export function classifyModelError(err: unknown, provider: AnthropicFamily = "anthropic"): { kind: ModelErrorKind; message: string } | null {
  const name = PROVIDER_NAME[provider];
  if (err instanceof Anthropic.APIUserAbortError) return null;
  if (err instanceof Anthropic.APIError && (err.status === 402 || (err.status === 400 && NO_CREDITS.test(err.message)))) {
    const where = provider === "openrouter" ? "Add credits at openrouter.ai/credits" : "Add credits in the Anthropic console (Plans & Billing)";
    return { kind: "no_credits", message: `${name} says the account is out of credits. ${where}, or switch provider with --provider.` };
  }
  if (err instanceof Anthropic.AuthenticationError) return { kind: "auth", message: `${name} rejected the API key (401). Check ${KEY_NAME[provider]}.` };
  if (err instanceof Anthropic.PermissionDeniedError) return { kind: "permission", message: `${name} denied the request (403): ${err.message}` };
  if (err instanceof Anthropic.RateLimitError) return { kind: "rate_limit", message: `${name} rate limit reached (429). Wait a moment and send the message again.` };
  if (err instanceof Anthropic.APIConnectionError) return { kind: "connection", message: `Could not reach the ${name} API: ${err.message}` };
  if (err instanceof Anthropic.APIError) {
    if (err.status === 529) return { kind: "overloaded", message: `${name} is overloaded (529). Send the message again shortly.` };
    if (err.status !== undefined && err.status >= 500) return { kind: "server", message: `${name} server error (${err.status}): ${err.message}` };
    return { kind: "request", message: `${name} rejected the request (${err.status ?? "no status"}): ${err.message}` };
  }
  return null;
}

/** The client for BK's Anthropic key. Reads ANTHROPIC_API_KEY only; the key is never stored (03#model-and-sdk). */
export function clientFromEnv(env: Record<string, string | undefined> = process.env): Anthropic | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  return apiKey ? new Anthropic({ apiKey }) : null;
}

/** OpenRouter serves an Anthropic Messages endpoint at /api/v1/messages; the SDK appends /v1 to this base (D-107). */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api";

/** The client for BK's OpenRouter key, sent as a bearer token. Reads OPENROUTER_API_KEY only. */
export function openRouterClientFromEnv(env: Record<string, string | undefined> = process.env): Anthropic | null {
  const authToken = env.OPENROUTER_API_KEY?.trim();
  // apiKey: null stops the SDK from also looking for ANTHROPIC_API_KEY and sending it to OpenRouter.
  return authToken ? new Anthropic({ apiKey: null, authToken, baseURL: OPENROUTER_BASE_URL }) : null;
}
