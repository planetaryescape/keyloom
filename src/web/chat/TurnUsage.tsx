import type { ChatAccounting } from "../../api/http.ts";

/** Only the exact Opus 5.5 IDs whose list prices evals/provider.ts uses. Never infer a model. */
function estimatedCost(accounting: ChatAccounting): number | undefined {
  const { provider, model, usage } = accounting;
  if (!((provider === "anthropic" && model === "claude-opus-5-5") || (provider === "openrouter" && model === "anthropic/claude-opus-5.5"))) return undefined;
  return (usage.inputTokens * 4 + usage.outputTokens * 20 + usage.cacheReadTokens * 0.2 + usage.cacheCreationTokens * 5) / 1e6;
}

function dollars(cost: number): string {
  // A small positive charge must never round down to a claim that the turn was free.
  return cost > 0 && cost < 0.0001 ? "<$0.0001" : `$${cost.toFixed(4)}`;
}

/** Quiet, visible facts below each reply, including legacy and interrupted turns. */
export function TurnUsage({ accounting }: { accounting: ChatAccounting | undefined }) {
  const usage = accounting?.usage;
  // Adapters initialise missing usage to zero (notably a Codex turn stopped to ask a question).
  const hasTokens = usage !== undefined && (usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens) > 0;
  const estimate = accounting !== undefined && hasTokens ? estimatedCost(accounting) : undefined;
  const cost = accounting?.costUsd;
  const costText = cost !== undefined ? `${dollars(cost)} USD reported` : estimate !== undefined ? `${dollars(estimate)} USD estimated` : "Cost not reported · estimate unavailable";
  const tokens = hasTokens ? [
    `${usage.inputTokens.toLocaleString("en-US")} input`, `${usage.outputTokens.toLocaleString("en-US")} output`,
    ...(usage.cacheReadTokens > 0 ? [`${usage.cacheReadTokens.toLocaleString("en-US")} cache read`] : []),
    ...(usage.cacheCreationTokens > 0 ? [`${usage.cacheCreationTokens.toLocaleString("en-US")} cache write`] : []),
  ].join(" · ") + " tokens" : "Token usage not reported";
  return <p className="msg-usage"><span className="sr-only">Turn usage and cost: </span>{tokens}{" "}<span>{costText}</span></p>;
}
