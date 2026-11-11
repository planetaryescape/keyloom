// The provider failures a chat turn can meet after keyloom accepted it, as the SDK raises them. Shared by the app tests, which run them
// through the real turn, and the fake chat's fail_after_accept mode, which shows the page what the real classifier would say (R4-02).
import Anthropic from "@anthropic-ai/sdk";
import { classifyModelError } from "../../src/agent/anthropic-model.ts";
import { codexErrorFor } from "../../src/agent/codex/errors.ts";
import type { AgentModel, ModelErrorKind } from "../../src/agent/model.ts";

const status = (code: number, message: string) => () => Anthropic.APIError.generate(code, { type: "error", error: { message } }, message, new Headers());

/** One SDK error per kind BK can act on. `missing_key` comes from Codex, not the SDK; it is covered by the Codex tests. */
export const MODEL_FAILURES = {
  auth: status(401, "Invalid bearer token"),
  no_credits: status(402, "Insufficient credits"),
  permission: status(403, "This key may not use anthropic/claude-opus-5.5"),
  rate_limit: status(429, "Rate limit exceeded"),
  overloaded: status(529, "Overloaded"),
  server: status(500, "Internal server error"),
  connection: () => new Anthropic.APIConnectionError({ message: "fetch failed" }),
  context_full: status(400, "prompt is too long: 212345 tokens > 200000 maximum"),
} as const satisfies Partial<Record<ModelErrorKind, () => unknown>>;

export type FailureKind = keyof typeof MODEL_FAILURES;

/** Codex's failures arrive as sentences, not SDK errors (codex/errors.ts). This one is codex-rs's Plus-plan usage limit (R5-04). */
export const CODEX_FAILURES = {
  usage_limit: "You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits or try again at 3:45 PM.",
} as const;

/** A failure the fake chat can show: an SDK one, or a Codex one. */
export type ShownFailureKind = FailureKind | keyof typeof CODEX_FAILURES;
export const isShownFailureKind = (value: string): value is ShownFailureKind => Object.hasOwn(MODEL_FAILURES, value) || Object.hasOwn(CODEX_FAILURES, value);

/** What the real classifier makes of that failure: OpenRouter's for an SDK failure, Codex's for a Codex one. */
export function classifiedFailure(kind: ShownFailureKind): { kind: ModelErrorKind; message: string } {
  if (kind === "usage_limit") {
    const err = codexErrorFor(CODEX_FAILURES[kind]);
    return { kind: err.kind, message: err.message };
  }
  const known = classifyModelError(MODEL_FAILURES[kind](), "openrouter");
  if (known === null) throw new Error(`the classifier does not know ${kind}`);
  return known;
}

/** A model whose first call fails that way, after the turn was accepted. */
export function failingModel(kind: FailureKind): AgentModel {
  return {
    provider: "openrouter", model: "anthropic/claude-opus-5.5", effort: "medium",
    run: () => Promise.reject(MODEL_FAILURES[kind]()),
    classifyError: (err) => classifyModelError(err, "openrouter"),
  };
}
