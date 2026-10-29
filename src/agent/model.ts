// The seam between keyloom and the model provider (03#model-and-sdk). Everything above this file
// speaks these types, so tests script a model without a network and a second provider (Q3) is one
// new implementation.
import type { z } from "zod";
import type { ProviderId } from "./provider.ts";

/**
 * A stored content block, neutral between providers (D-111). `providerData` is the provider's own
 * block, opaque to everything but that provider's adapter: it replays it unchanged, which models
 * with thinking blocks require. An `opaque` block has nothing neutral to say (a thinking block).
 */
export type ContentBlock =
  | { type: "text"; text: string; providerData?: unknown }
  | { type: "tool_use"; id: string; name: string; input: unknown; providerData?: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean; providerData?: unknown }
  | { type: "opaque"; providerData: unknown };

export type ModelMessage = { role: "user" | "assistant"; content: ContentBlock[] };

/** A tool the model may call. `run` receives the model's raw input and parses it itself; a throw becomes an error result the model can read. */
export type ModelTool = {
  name: string;
  description: string;
  inputSchema: z.ZodObject;
  /** Send the schema as `strict`. The API refuses a grammar that is too large, which the ChangeOp union is. Defaults to true. */
  strict?: boolean;
  /**
   * Calling it ends the turn: the question goes to the person, who may take hours to answer or reload meanwhile, so no process waits.
   * The adapter stops the loop at the call and stores the `tool_use` with no result; the answer arrives later as that call's `tool_result`
   * (D-382). Other tools called in the same reply get an error result saying they were not run.
   */
  pauses?: boolean;
  run: (rawInput: unknown) => Promise<string> | string;
};

export const AWAITING_ANSWER = "awaiting_answer";

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
  /** Completed public messages only; never opaque thinking. Whole-message fallback is intentional. */
  onPublicMessage?: (message: { id: string; kind: "working_note" | "answer"; text: string }) => void;
  /**
   * Called once, when the pausing call comes up in the order the model made its calls: every call it made before the question has run, and
   * a call it made after has not (D-452). That is how the turn tells the proposals saved before a question from those saved beside it.
   * A provider that cannot say leaves it uncalled, and everything saved counts as before the question.
   */
  onPause?: () => void;
  signal?: AbortSignal;
};

export type ModelResult = {
  /** Every message the loop added after `request.messages`: assistant turns and the user turns carrying tool results. */
  messages: ModelMessage[];
  /** The last response's stop reason. `tool_use` means the iteration limit stopped a loop that still wanted tools; `awaiting_answer` means a pausing tool was called. */
  stopReason: string;
  iterations: number;
  usage: Usage;
  /** Set with stopReason `awaiting_answer`: the pausing tool call the turn stopped on. */
  pending?: { id: string; name: string; input: unknown };
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
