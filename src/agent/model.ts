// The seam between keyloom and the model provider (03#model-and-sdk). Everything above this file
// speaks these types, so tests script a model without a network and a second provider (Q3) is one
// new implementation.
import type { z } from "zod";
import type { ProviderId } from "./provider.ts";

/** An Anthropic content block, carried as the provider sent it. keyloom stores and replays these unchanged. */
export type ContentBlock = { type: string; [key: string]: unknown };

export type ModelMessage = { role: "user" | "assistant"; content: ContentBlock[] };

/** A tool the model may call. `run` receives the model's raw input and parses it itself; a throw becomes an error result the model can read. */
export type ModelTool = {
  name: string;
  description: string;
  inputSchema: z.ZodObject;
  /** Send the schema as `strict`. The API refuses a grammar that is too large, which the ChangeOp union is. Defaults to true. */
  strict?: boolean;
  run: (rawInput: unknown) => Promise<string> | string;
};

export type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number };

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });

export const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
});

export type ModelRequest = {
  system: string;
  /** The conversation so far, ending with the user message to answer. */
  messages: ModelMessage[];
  tools: ModelTool[];
  /** API requests the loop may make before it stops, even if the model still wants tools. */
  maxIterations: number;
  onText?: (delta: string) => void;
  signal?: AbortSignal;
};

export type ModelResult = {
  /** Every message the loop added after `request.messages`: assistant turns and the user turns carrying tool results. */
  messages: ModelMessage[];
  /** The last response's stop reason. `tool_use` means the iteration limit stopped a loop that still wanted tools. */
  stopReason: string;
  iterations: number;
  usage: Usage;
  /** What the provider charged, when it says (OpenRouter's `usage.cost`). Absent for a provider that doesn't, such as Codex. */
  costUsd?: number;
};

export type ModelErrorKind = "missing_key" | "auth" | "no_credits" | "permission" | "rate_limit" | "overloaded" | "connection" | "request" | "server";

export interface AgentModel {
  /** Recorded in the per-turn log. */
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
  run(request: ModelRequest): Promise<ModelResult>;
  /** Maps this provider's failure to the few kinds BK acts on; null when it isn't a model API failure, so a bug stays a bug. */
  classifyError(err: unknown): { kind: ModelErrorKind; message: string } | null;
}
