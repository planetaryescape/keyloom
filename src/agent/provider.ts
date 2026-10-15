// The providers keyloom can run the agent on (D-106) and the model each starts with. Kept free of
// any SDK import so the app, the CLI and the web chat can all name a provider without loading one.
export const PROVIDERS = ["anthropic", "openrouter", "codex"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export const isProviderId = (value: unknown): value is ProviderId => PROVIDERS.includes(value as ProviderId);

/** The ID is a config value (`agent.model`); these are the defaults per provider (D-107, D-108). */
export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: "claude-opus-5-5",
  openrouter: "anthropic/claude-opus-5.5",
  codex: "gpt-6.1-sol",
};

/** What a person sets or logs in with, named in the missing-credential messages. */
export const CREDENTIAL_HINT: Record<ProviderId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  codex: "`codex login`",
};
