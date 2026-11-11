// Where the app gets its model (19): the provider is chosen by the --provider flag, then the
// KEYLOOM_PROVIDER variable, then the data directory's config, then the first provider that has a
// credential. Keys come from the environment, or from the system key store when keyloom saved one there (D-496); the
// environment wins. Neither the key nor any part but its last four characters leaves this process.
import { type AgentModel } from "../agent/model.ts";
import { DEFAULT_EFFORT, anthropicModel, clientFromEnv, openRouterClientFromEnv } from "../agent/anthropic-model.ts";
import { LOGIN_HINT } from "../agent/codex/errors.ts";
import { checkCodexLogin } from "../agent/codex/login.ts";
import { DEFAULT_MODELS, PROVIDERS, type ProviderId, isProviderId } from "../agent/provider.ts";
import { type AgentConfig, readAgentConfig, writeAgentConfig } from "./agent-config.ts";
import { type CredentialSource, type StoreKind, credentials } from "./credentials.ts";
import { codexSignIn, type CodexSignInState } from "./codex-signin.ts";
import { ModelError, UsageError } from "./errors.ts";

type Env = Record<string, string | undefined>;

export type ModelChoice = {
  /** From `--provider`; wins over everything else. */
  provider?: ProviderId;
  /** A conversation's own model, when it is continuing one (D-111). */
  model?: string;
};

const MISSING: Record<"anthropic" | "openrouter", string> = {
  anthropic: "ANTHROPIC_API_KEY is not set and no Anthropic key is saved. Save one with `keyloom provider key set anthropic`, or set ANTHROPIC_API_KEY, for example: op run -- keyloom chat <layout>",
  openrouter: "OPENROUTER_API_KEY is not set and no OpenRouter key is saved. Save one with `keyloom provider key set openrouter`, or set OPENROUTER_API_KEY, for example: op run -- keyloom chat <layout> --provider openrouter",
};

const hasEnv = (env: Env, name: string) => Boolean(env[name]?.trim());

/** The providers whose key is in the environment, in the order the default is picked. */
export function keyedProviders(env: Env = process.env): ProviderId[] {
  return PROVIDERS.filter((p) => (p === "anthropic" ? clientFromEnv(env) !== null : p === "openrouter" ? hasEnv(env, "OPENROUTER_API_KEY") : false));
}

function envProvider(env: Env): ProviderId | undefined {
  const value = env.KEYLOOM_PROVIDER?.trim();
  if (!value) return undefined;
  if (!isProviderId(value)) throw new UsageError(`KEYLOOM_PROVIDER is "${value}"; use one of ${PROVIDERS.join(", ")}`);
  return value;
}

/** The provider named by the flag, the variable or the config, before any credential is looked at. */
const explicitProvider = (choice: ModelChoice, config: AgentConfig, env: Env): ProviderId | undefined => choice.provider ?? envProvider(env) ?? config.provider;

/** Which provider this message uses, and where that came from. Throws a missing_key ModelError when nothing is set up. */
export async function chooseProvider(choice: ModelChoice, config: AgentConfig, env: Env = process.env, codexReady?: boolean): Promise<ProviderId> {
  const explicit = explicitProvider(choice, config, env);
  if (explicit) return explicit;
  const first = keyedProviders(env)[0];
  if (first) return first;
  // Asking Codex runs a process, so it is the last resort.
  if (codexReady ?? (await checkCodexLogin(env)).ready) return "codex";
  throw new ModelError(
    "missing_key",
    `No model provider is set up. Save a key with \`keyloom provider key set anthropic\`, set ANTHROPIC_API_KEY or OPENROUTER_API_KEY, or run \`codex login\`.`,
  );
}

export async function defaultAgentModel(dataDir: string, choice: ModelChoice = {}, baseEnv: Env = process.env): Promise<AgentModel> {
  // Read at each call, not at startup, so a key saved a moment ago answers the next message (D-496). Only the answering
  // provider's key is read, so a stalled read for another provider can't hold up a key that is in the environment.
  const config = readAgentConfig(dataDir);
  const env = await credentials().envFor(baseEnv, explicitProvider(choice, config, baseEnv));
  const provider = await chooseProvider(choice, config, env);
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
    case "codex": {
      const login = await checkCodexLogin(env);
      if (!login.ready) {
        throw new ModelError("missing_key", login.reason === "not_installed" ? "The Codex CLI is not installed. Install it, then run `codex login`." : `Codex is not signed in. ${LOGIN_HINT}`);
      }
      // Loaded here, not at startup: it brings the MCP SDK, which every CLI invocation would otherwise pay for.
      const { codexModel } = await import("../agent/codex-model.ts");
      return codexModel({ ...opts, env });
    }
  }
}

export type ProviderStatus = {
  /** What the next new conversation would use; null when nothing is set up. */
  active: { provider: ProviderId; model: string; effort: string } | null;
  /** What outranks the config file, so a choice made in the picker would not apply; null when nothing does. */
  lockedBy: "--provider" | "KEYLOOM_PROVIDER" | null;
  /** Where a pasted key can be saved; null on a computer with none, where only the environment works. */
  keyStore: StoreKind | null;
  /** A `codex login` keyloom started and is waiting on. */
  codexSignIn: CodexSignInState;
  providers: Array<{
    id: ProviderId; label: string; defaultModel: string; ready: boolean; setup: string; command: string;
    /** Where the key comes from and its last four characters; null for Codex and for a provider with no key. */
    credential: CredentialSource | null;
    /** False only for Codex when its CLI is not on this computer, so signing in can't be offered. */
    installed: boolean;
  }>;
};

const SETUP: Record<ProviderId, { label: string; setup: string; command: string }> = {
  anthropic: { label: "Anthropic API key", setup: "Save a key with `keyloom provider key set anthropic`, or start keyloom with ANTHROPIC_API_KEY set.", command: "ANTHROPIC_API_KEY=<your key> keyloom serve" },
  openrouter: { label: "OpenRouter API key", setup: "Save a key with `keyloom provider key set openrouter`, or start keyloom with OPENROUTER_API_KEY set.", command: "OPENROUTER_API_KEY=<your key> keyloom serve" },
  codex: { label: "Codex (ChatGPT login)", setup: "Sign in once with the Codex CLI, then start keyloom.", command: "codex login" },
};

/** For the chat panel: which provider answers, and what each one still needs. Never throws on a missing credential. */
export async function providerStatus(dataDir: string, choice: ModelChoice = {}, baseEnv: Env = process.env): Promise<ProviderStatus> {
  // The store reads and `codex login status` don't depend on each other; Codex needs only CODEX_API_KEY and its binary from baseEnv.
  const [env, sources, codex, keyStore] = await Promise.all([credentials().env(baseEnv), credentials().sources(baseEnv), checkCodexLogin(baseEnv), credentials().usableStore()]);
  const config = readAgentConfig(dataDir);
  const ready = new Set<ProviderId>(keyedProviders(env));
  if (codex.ready) ready.add("codex");
  let active: ProviderStatus["active"] = null;
  try {
    const provider = await chooseProvider(choice, config, env, codex.ready);
    const model = (config.provider === undefined || config.provider === provider ? config.model : undefined) ?? DEFAULT_MODELS[provider];
    // An explicit choice with no credential is still shown as active: the panel then says what is missing.
    active = { provider, model, effort: config.effort ?? DEFAULT_EFFORT };
  } catch (err) {
    if (!(err instanceof ModelError)) throw err;
  }
  const lockedBy = choice.provider ? "--provider" : hasEnvProvider(env) ? "KEYLOOM_PROVIDER" : null;
  return {
    active, lockedBy, keyStore, codexSignIn: codexSignIn().current(),
    providers: PROVIDERS.map((id) => ({
      id, defaultModel: DEFAULT_MODELS[id], ready: ready.has(id), ...SETUP[id],
      credential: id === "codex" ? null : sources[id],
      installed: id !== "codex" || codex.ready || codex.reason !== "not_installed",
    })),
  };
}

// A bad KEYLOOM_PROVIDER already surfaces as a UsageError from chooseProvider; the lock only needs to know whether a valid one is set.
const hasEnvProvider = (env: Env): boolean => isProviderId(env.KEYLOOM_PROVIDER?.trim());

/** The picker's save: validated by the caller's schema, written to the data directory's config, and applied from the next conversation (D-111). */
export async function chooseNextProvider(dataDir: string, choice: { provider: ProviderId; model?: string | undefined }, current: ModelChoice = {}, env: Env = process.env): Promise<ProviderStatus> {
  writeAgentConfig(dataDir, choice);
  return providerStatus(dataDir, current, env);
}
