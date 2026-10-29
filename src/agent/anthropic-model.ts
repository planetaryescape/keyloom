// The Anthropic implementation of AgentModel (D-031): the SDK's beta Tool Runner over zod tools,
// streaming, with adaptive thinking and an explicit effort. This is the only file that imports the SDK.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import {
  AWAITING_ANSWER, type AgentModel, type ModelErrorKind, type ModelMessage, type ModelTool, type Usage, addUsage, emptyUsage,
} from "./model.ts";
import { neutralBlock, wireBlock } from "./blocks.ts";
import { DEFAULT_MODELS } from "./provider.ts";

export type { ModelErrorKind } from "./model.ts";

/** 03#model-and-sdk. The ID is a config value (`agent.model`); this is its default. */
export const DEFAULT_MODEL = DEFAULT_MODELS.anthropic;
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export const DEFAULT_EFFORT: Effort = "medium";

// Room for thinking plus a proposal; streaming keeps a long reply from timing out.
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
          messages: request.messages.map(toWire),
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
      let completeCost = true;
      let iterations = 0;
      let stopReason: string | null = null;
      let pause: { message: { content: unknown[] }; call: { id: string; name: string; input: unknown } } | undefined;
      let publicMessages = 0;
      const pausing = new Set(request.tools.filter((t) => t.pauses === true).map((t) => t.name));
      for await (const stream of runner) {
        if (request.onText) stream.on("text", (delta) => request.onText?.(delta));
        // The SDK's final message copies only the usage fields it knows, so OpenRouter's `cost` (sent in
        // the closing message_delta, S19) has to be read from the raw event.
        let cost: number | undefined;
        stream.on("streamEvent", (event) => {
          if (event.type !== "message_delta") return;
          const reported = (event.usage as RawUsage).cost;
          if (typeof reported === "number" && Number.isFinite(reported) && reported >= 0) cost = reported;
        });
        const message = await stream.finalMessage();
        iterations++;
        usage = addUsage(usage, usageOf(message.usage));
        if (cost !== undefined) costUsd = (costUsd ?? 0) + cost;
        else completeCost = false;
        stopReason = message.stop_reason;
        if (message.stop_reason !== "refusal") {
          const publicText = message.content.flatMap((b) => b.type === "text" ? [b.text] : []).join("");
          if (publicText) request.onPublicMessage?.({ id: `public_${++publicMessages}`, kind: message.stop_reason === "end_turn" && !message.content.some((b) => b.type === "tool_use") ? "answer" : "working_note", text: publicText });
        }
        if (message.stop_reason === "refusal") {
          break;
        }
        // A question for the person ends the turn here, before the runner runs any tool or asks the model again (D-382).
        const call = message.content.find((b) => b.type === "tool_use" && pausing.has(b.name) && request.tools.find((tool) => tool.name === b.name)?.inputSchema.safeParse(b.input).success);
        if (call !== undefined && call.type === "tool_use") {
          pause = { message, call: { id: call.id, name: call.name, input: call.input } };
          break;
        }
      }
      // One missing iteration makes the total unknown. A partial sum is not the reported price of a turn.
      if (!completeCost) costUsd = undefined;
      if (pause !== undefined) {
        // The runner appends the assistant message only when it goes on to answer the calls, so the stopped one is added here. The API wants a
        // result for every call before the next message. A call beside the question is run first: a proposal batched with its question must
        // reach the board (D-452), where answering "not run" would leave BK a question over an empty board. A second question is not run.
        // The calls are walked in the order the model wrote them, and the turn is told where the question falls: a proposal saved before that
        // point is one the question may refine, and one saved after it never is.
        const uses = pause.message.content as Array<{ type: string; id?: string; name?: string; input?: unknown }>;
        const results = [];
        for (const b of uses) {
          if (b.type !== "tool_use") continue;
          if (b.id === pause.call.id) {
            request.onPause?.();
            continue;
          }
          const tool = request.tools.find((candidate) => candidate.name === b.name);
          const base = { type: "tool_result" as const, tool_use_id: b.id as string };
          if (tool === undefined || tool.pauses === true) {
            results.push({ ...base, content: "Not run: you asked BK a question in the same reply. Call it again after the answer if it is still needed.", is_error: true });
            continue;
          }
          try {
            results.push({ ...base, content: await tool.run(b.input) });
          } catch (err) {
            results.push({ ...base, content: err instanceof Error ? err.message : String(err), is_error: true });
          }
        }
        const stored: ModelMessage[] = [
          toStored({ role: "assistant", content: pause.message.content }),
          ...(results.length === 0 ? [] : [{ role: "user" as const, content: results }]),
        ];
        const before = runner.params.messages.slice(request.messages.length).map((m) => toStored(m as { role: "user" | "assistant"; content: unknown }));
        return { messages: [...before, ...stored], stopReason: AWAITING_ANSWER, iterations, usage, pending: pause.call, ...(costUsd === undefined ? {} : { costUsd }) };
      }
      // The runner's own copy of the conversation now holds the assistant turns and tool results it added.
      const added = runner.params.messages.slice(request.messages.length);
      return { messages: added.map((m) => toStored(m as { role: "user" | "assistant"; content: unknown })), stopReason: stopReason ?? "end_turn", iterations, usage, ...(costUsd === undefined ? {} : { costUsd }) };
    },
  };
}

/** A user turn's content may be a bare string in the SDK's types; storage keeps neutral blocks (D-111). */
function toStored(m: { role: "user" | "assistant"; content: unknown }): ModelMessage {
  const raw = typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content as Array<{ type: string }>);
  return { role: m.role, content: raw.map(neutralBlock) };
}

/** Anthropic blocks are replayed exactly as the API sent them: models with thinking reject an edited history. */
const toWire = (m: ModelMessage): BetaMessageParam => ({ role: m.role, content: m.content.map(wireBlock) as BetaMessageParam["content"] });

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

/** The direct API client reads only the explicit API key, never another app's login or token cache. */
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
