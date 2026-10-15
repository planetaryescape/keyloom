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
