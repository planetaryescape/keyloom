// One read against the provider's API that tells a good key from a refused one without spending tokens (11#logs). `doctor`
// runs it for each key it finds, and saving a pasted key runs it before the key is stored (D-496).
import { classifyModelError, clientFromEnv, openRouterClientFromEnv } from "../agent/anthropic-model.ts";
import { DEFAULT_MODELS } from "../agent/provider.ts";

/** The providers whose credential keyloom can check with an API read: the two it has a key for, not Codex's login. */
export type KeyedProvider = "anthropic" | "openrouter";

/** What one provider's check found: `rejected` is the credential failing, `unchecked` is not being able to tell. */
export type CredentialOutcome = { status: "ok" } | { status: "rejected" | "unchecked"; reason: string };

/** One round trip, and short enough that a hung network can't hang `doctor` (11#logs). */
const CREDENTIAL_TIMEOUT_MS = 5_000;

export async function verifyCredential(provider: KeyedProvider, env: Record<string, string | undefined>): Promise<CredentialOutcome> {
  const client = provider === "anthropic" ? clientFromEnv(env) : openRouterClientFromEnv(env);
  if (!client) return { status: "unchecked", reason: `${provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENROUTER_API_KEY"} is not set` };
  try {
    await client.models.retrieve(DEFAULT_MODELS[provider], null, { timeout: CREDENTIAL_TIMEOUT_MS, maxRetries: 0 });
    return { status: "ok" };
  } catch (err) {
    const failure = classifyModelError(err, provider);
    // A rejected key is the answer this check exists for. Anything else (no network, a rate limit, a model the account
    // can't see) can't tell a good credential from a bad one, and `doctor` must not fail on a flaky connection.
    if (failure !== null && (failure.kind === "auth" || failure.kind === "permission")) return { status: "rejected", reason: failure.message };
    return { status: "unchecked", reason: failure?.message ?? (err instanceof Error ? err.message : String(err)) };
  }
}
