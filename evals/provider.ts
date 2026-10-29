// What every live scenario shares (19#evals-run-per-provider): which provider it runs on, the gate
// that checks that provider's credential, and report names and cost lines tagged with the provider.
// Not a scenario itself, so `bun test` doesn't collect it.
import { execFileSync } from "node:child_process";
import { PROVIDERS, type ProviderId, isProviderId } from "../src/agent/provider.ts";
import type { Usage } from "../src/agent/model.ts";
import type { ChatOutcome } from "../src/app/index.ts";

const requested = process.env.KEYLOOM_EVAL_PROVIDER ?? "anthropic";
if (!isProviderId(requested)) throw new Error(`KEYLOOM_EVAL_PROVIDER is "${requested}"; use one of ${PROVIDERS.join(", ")}`);
export const evalProvider: ProviderId = requested;

function codexLoggedIn(): boolean {
  try {
    execFileSync("codex", ["login", "status"], { stdio: "ignore", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

const credentialPresent: Record<ProviderId, () => boolean> = {
  anthropic: () => Boolean(process.env.ANTHROPIC_API_KEY),
  openrouter: () => Boolean(process.env.OPENROUTER_API_KEY),
  codex: codexLoggedIn,
};

/** Live evals cost money, so they need KEYLOOM_LIVE_EVALS=1 and the credential of the provider under test. */
export const live = process.env.KEYLOOM_LIVE_EVALS === "1" && credentialPresent[evalProvider]();

// Opus 5.5 list prices (12-cost-model): $4/M input, $20/M output, $0.20/M cache reads; cache writes at 1.25x input.
const listPrice = (u: Usage) => (u.inputTokens * 4 + u.outputTokens * 20 + u.cacheReadTokens * 0.2 + u.cacheCreationTokens * 5) / 1e6;

/** The provider's own figure when every turn reported one; the price table for Anthropic; null where neither exists (Codex). */
export function costUsd(outcomes: ChatOutcome[], usage: Usage): number | null {
  if (outcomes.length > 0 && outcomes.every((o) => o.costUsd !== undefined)) return outcomes.reduce((n, o) => n + (o.costUsd ?? 0), 0);
  return evalProvider === "codex" ? null : listPrice(usage);
}

export function costLine(outcomes: ChatOutcome[], usage: Usage): string {
  const cost = costUsd(outcomes, usage);
  if (cost === null) return "Cost: not reported by Codex (tokens only).";
  return `${outcomes.every((o) => o.costUsd !== undefined) ? "Reported cost" : "Estimated cost"}: $${cost.toFixed(3)}.`;
}

/** Report files carry the provider; a model ID like anthropic/claude-opus-5.5 is not a safe file name as it stands. */
export const reportFile = (date: string, model: string | undefined, effort: string | undefined, scenario: string): string =>
  `${date}-${evalProvider}-${(model ?? "unknown").replaceAll("/", "-")}-${effort}-${scenario}.md`;

/** What a question says to BK: its words, what matters and each option. */
const questionWords = (o: ChatOutcome): string[] => {
  const q = o.question;
  return q === undefined ? [] : [q.question, ...(q.considerations ?? []), ...q.options.flatMap((opt) => [opt.label, opt.description ?? ""])];
};

/**
 * D-279: keys are named by what they print and where they sit, never by number. True when no reply, question, proposal title,
 * explanation or trade-off says "key 43" or "position 30" to BK.
 */
export function namesNoKeyNumbers(outcomes: readonly ChatOutcome[]): boolean {
  const said = outcomes.flatMap((o) => [o.text, ...questionWords(o), ...o.proposals.flatMap((p) => [p.title, p.explanation, ...p.tradeoffs.gains, ...p.tradeoffs.costs])]);
  return said.every((text) => !/\b(key|position)\s+\d+/i.test(text));
}
