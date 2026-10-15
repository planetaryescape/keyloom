// The Anthropic implementation of AgentModel (D-031): the SDK's beta Tool Runner over zod tools,
// streaming, with adaptive thinking and an explicit effort. This is the only file that imports the SDK.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { type AgentModel, type ContentBlock, type ModelMessage, type ModelTool, type Usage, addUsage, emptyUsage } from "./model.ts";

/** 03#model-and-sdk. The ID is a config value (`agent.model`); this is its default. */
export const DEFAULT_MODEL = "claude-opus-5-5";
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
    strict: true,
    eager_input_streaming: true,
    // The runner would parse with zod before `run`; defineTool does it so a bad input is recorded and explained.
    parse: (raw: unknown) => raw,
  } as typeof base;
}

type RawUsage = { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

const usageOf = (u: RawUsage): Usage => ({
  inputTokens: u.input_tokens ?? 0,
  outputTokens: u.output_tokens ?? 0,
  cacheReadTokens: u.cache_read_input_tokens ?? 0,
  cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
});

export function anthropicModel(client: Anthropic, opts: { model?: string; effort?: Effort } = {}): AgentModel {
  const model = opts.model ?? DEFAULT_MODEL;
  const effort = opts.effort ?? DEFAULT_EFFORT;
  return {
    model,
    effort,
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
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          // Caches up to the last block, so a follow-up message re-reads the system prompt and history cheaply.
          cache_control: { type: "ephemeral" },
        },
        request.signal ? { signal: request.signal } : undefined,
      );

      let usage = emptyUsage();
      let iterations = 0;
      let stopReason: string | null = null;
      for await (const stream of runner) {
        if (request.onText) stream.on("text", (delta) => request.onText?.(delta));
        const message = await stream.finalMessage();
        iterations++;
        usage = addUsage(usage, usageOf(message.usage));
        stopReason = message.stop_reason;
      }
      // The runner's own copy of the conversation now holds the assistant turns and tool results it added.
      const added = runner.params.messages.slice(request.messages.length) as ModelMessage[];
      return { messages: added.map(toStored), stopReason: stopReason ?? "end_turn", iterations, usage };
    },
  };
}

/** A user turn's content may be a bare string in the SDK's types; storage keeps blocks. */
function toStored(m: { role: "user" | "assistant"; content: unknown }): ModelMessage {
  const content = typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content as ContentBlock[]);
  return { role: m.role, content };
}

export type ModelErrorKind = "missing_key" | "auth" | "permission" | "rate_limit" | "overloaded" | "connection" | "request" | "server";

/** Maps an SDK failure to the few kinds BK acts on; null when it isn't a model API failure, so a bug stays a bug. */
export function classifyModelError(err: unknown): { kind: ModelErrorKind; message: string } | null {
  if (err instanceof Anthropic.APIUserAbortError) return null;
  if (err instanceof Anthropic.AuthenticationError) return { kind: "auth", message: "Anthropic rejected the API key (401). Check ANTHROPIC_API_KEY." };
  if (err instanceof Anthropic.PermissionDeniedError) return { kind: "permission", message: `Anthropic denied the request (403): ${err.message}` };
  if (err instanceof Anthropic.RateLimitError) return { kind: "rate_limit", message: "Anthropic rate limit reached (429). Wait a moment and send the message again." };
  if (err instanceof Anthropic.APIConnectionError) return { kind: "connection", message: `Could not reach the Anthropic API: ${err.message}` };
  if (err instanceof Anthropic.APIError) {
    if (err.status === 529) return { kind: "overloaded", message: "Anthropic is overloaded (529). Send the message again shortly." };
    if (err.status !== undefined && err.status >= 500) return { kind: "server", message: `Anthropic server error (${err.status}): ${err.message}` };
    return { kind: "request", message: `Anthropic rejected the request (${err.status ?? "no status"}): ${err.message}` };
  }
  return null;
}

/** The client for BK's own key. Reads ANTHROPIC_API_KEY only; the key is never stored (03#model-and-sdk). */
export function clientFromEnv(env: Record<string, string | undefined> = process.env): Anthropic | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  return apiKey ? new Anthropic({ apiKey }) : null;
}
