// Where the app gets its model (19): the provider is chosen by the --provider flag, then the
// KEYLOOM_PROVIDER variable, then the data directory's config, then the first provider that has a
// credential. Keys come from the environment and are never stored (03#model-and-sdk).
import { type AgentModel } from "../agent/model.ts";
import { DEFAULT_EFFORT, anthropicModel, clientFromEnv, openRouterClientFromEnv } from "../agent/anthropic-model.ts";
import { CREDENTIAL_HINT, DEFAULT_MODELS, PROVIDERS, type ProviderId, isProviderId } from "../agent/provider.ts";
import { type AgentConfig, readAgentConfig } from "./agent-config.ts";
import { ModelError, UsageError } from "./errors.ts";

type Env = Record<string, string | undefined>;

export type ModelChoice = {
  /** From `--provider`; wins over everything else. */
  provider?: ProviderId;
  /** A conversation's own model, when it is continuing one (D-111). */
  model?: string;
};

const MISSING: Record<"anthropic" | "openrouter", string> = {
  anthropic: "ANTHROPIC_API_KEY is not set. keyloom reads your Anthropic key from that environment variable only, for example: op run -- keyloom chat <layout>",
  openrouter: "OPENROUTER_API_KEY is not set. keyloom reads your OpenRouter key from that environment variable only, for example: op run -- keyloom chat <layout> --provider openrouter",
};

const hasEnv = (env: Env, name: string) => Boolean(env[name]?.trim());

/** What is set up on this machine, in the order the default is picked. */
export function credentialedProviders(env: Env = process.env): ProviderId[] {
  return PROVIDERS.filter((p) => (p === "anthropic" ? hasEnv(env, "ANTHROPIC_API_KEY") : p === "openrouter" ? hasEnv(env, "OPENROUTER_API_KEY") : false));
}

function envProvider(env: Env): ProviderId | undefined {
  const value = env.KEYLOOM_PROVIDER?.trim();
  if (!value) return undefined;
  if (!isProviderId(value)) throw new UsageError(`KEYLOOM_PROVIDER is "${value}"; use one of ${PROVIDERS.join(", ")}`);
  return value;
}

/** Which provider this message uses, and where that came from. Throws a missing_key ModelError when nothing is set up. */
export function chooseProvider(choice: ModelChoice, config: AgentConfig, env: Env = process.env): ProviderId {
  const explicit = choice.provider ?? envProvider(env) ?? config.provider;
  if (explicit) return explicit;
  const first = credentialedProviders(env)[0];
  if (first) return first;
  throw new ModelError(
    "missing_key",
    `No model provider is set up. Set ANTHROPIC_API_KEY, set OPENROUTER_API_KEY, or run \`codex login\`, for example: op run -- keyloom chat <layout>`,
  );
}

export function defaultAgentModel(dataDir: string, choice: ModelChoice = {}, env: Env = process.env): AgentModel {
  const config = readAgentConfig(dataDir);
  const provider = chooseProvider(choice, config, env);
  // A pinned conversation keeps its model; otherwise the config's model applies only to the provider it was written for.
  const model = choice.model ?? (config.provider === undefined || config.provider === provider ? config.model : undefined) ?? DEFAULT_MODELS[provider];
  const effort = config.effort;
  const opts = { model, ...(effort ? { effort } : {}) };
  switch (provider) {
    case "anthropic": {
      const client = clientFromEnv(env);
      if (!client) throw new ModelError("missing_key", MISSING.anthropic);
      return anthropicModel(client, opts);
    }
    case "openrouter": {
      const client = openRouterClientFromEnv(env);
      if (!client) throw new ModelError("missing_key", MISSING.openrouter);
      return anthropicModel(client, { ...opts, provider: "openrouter" });
    }
    case "codex":
      throw new ModelError("missing_key", `The codex provider needs ${CREDENTIAL_HINT.codex}`);
  }
}

export type ProviderStatus = {
  /** What the next new conversation would use; null when nothing is set up. */
  active: { provider: ProviderId; model: string; effort: string } | null;
  providers: Array<{ id: ProviderId; label: string; ready: boolean; setup: string; command: string }>;
};

const SETUP: Record<ProviderId, { label: string; setup: string; command: string }> = {
  anthropic: { label: "Anthropic API key", setup: "Start keyloom with ANTHROPIC_API_KEY set.", command: "ANTHROPIC_API_KEY=<your key> keyloom serve" },
  openrouter: { label: "OpenRouter API key", setup: "Start keyloom with OPENROUTER_API_KEY set.", command: "OPENROUTER_API_KEY=<your key> keyloom serve" },
  codex: { label: "Codex (ChatGPT login)", setup: "Sign in once with the Codex CLI, then start keyloom.", command: "codex login" },
};

/** For the chat panel: which provider answers, and what each one still needs. Never throws on a missing credential. */
export function providerStatus(dataDir: string, choice: ModelChoice = {}, env: Env = process.env): ProviderStatus {
  const config = readAgentConfig(dataDir);
  const ready = new Set(credentialedProviders(env));
  let active: ProviderStatus["active"] = null;
  try {
    const provider = chooseProvider(choice, config, env);
    const model = (config.provider === undefined || config.provider === provider ? config.model : undefined) ?? DEFAULT_MODELS[provider];
    // An explicit choice with no credential is still shown as active: the panel then says what is missing.
    active = { provider, model, effort: config.effort ?? DEFAULT_EFFORT };
  } catch (err) {
    if (!(err instanceof ModelError)) throw err;
  }
  return { active, providers: PROVIDERS.map((id) => ({ id, ready: ready.has(id), ...SETUP[id] })) };
}
