// What the model setup shows for each provider (D-496), decided from the status the server sent, never from error text.
import type { ChatProviderKey, ChatProviderStatus } from "../../api/http.ts";

type Provider = ChatProviderStatus["providers"][number];
/** The providers that take an API key, from the wire contract. */
export type KeyProvider = ChatProviderKey["provider"];

export const PROVIDER_NAMES: Record<Provider["id"], string> = { anthropic: "Anthropic", openrouter: "OpenRouter", codex: "Codex" };

/** Where each provider hands out keys, for the "Get a key" link. */
export const KEY_PAGES: Record<KeyProvider, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openrouter: "https://openrouter.ai/settings/keys",
};

/** Where each provider sells credits, for "Out of credits". */
export const CREDITS_PAGES: Record<KeyProvider, string> = {
  anthropic: "https://console.anthropic.com/settings/billing",
  openrouter: "https://openrouter.ai/settings/credits",
};

const STORE_NAMES: Record<NonNullable<ChatProviderStatus["keyStore"]>, string> = { keychain: "your Keychain", "secret-service": "your system keyring" };
const ENV_NAMES: Record<KeyProvider, string> = { anthropic: "ANTHROPIC_API_KEY", openrouter: "OPENROUTER_API_KEY" };

export type SetupView =
  /** Nothing to offer: Codex when its CLI is not on this computer. */
  | { kind: "hidden" }
  | { kind: "ready"; text: string; forget: boolean }
  /** A password field that saves to the key store. */
  | { kind: "paste"; note: string }
  /** No key store on this computer: the environment variable is the only way, so the command is shown to copy. */
  | { kind: "env-only"; text: string; command: string; keyPage: string }
  | { kind: "codex-sign-in"; text: string; failed: string | null }
  | { kind: "codex-waiting"; url: string | null };

/** `refused` is true when the provider just turned the key down (a refused key, no credits), so it is no longer shown as Ready. */
export function setupView(provider: Provider, status: Pick<ChatProviderStatus, "keyStore" | "codexSignIn">, refused = false): SetupView {
  if (provider.id === "codex") {
    if (status.codexSignIn.state === "waiting") return { kind: "codex-waiting", url: status.codexSignIn.url };
    if (provider.ready) return { kind: "ready", text: "Ready. Signed in to Codex with ChatGPT.", forget: false };
    if (!provider.installed) return { kind: "hidden" };
    return {
      kind: "codex-sign-in",
      text: "Uses your ChatGPT plan. Codex opens your browser to sign in.",
      failed: status.codexSignIn.state === "failed" ? status.codexSignIn.reason : null,
    };
  }
  const id = provider.id;
  const credential = provider.credential;
  if (credential?.source === "environment" && refused) {
    // keyloom can't change a variable it was started with, and a saved key would lose to it; the way out is a new variable.
    return {
      kind: "env-only",
      text: `${PROVIDER_NAMES[id]} didn't accept ${ENV_NAMES[id]} from your environment, ending ${credential.last4}. Start keyloom again with another key in ${ENV_NAMES[id]}.`,
      command: provider.command, keyPage: KEY_PAGES[id],
    };
  }
  if (credential?.source === "environment") {
    return { kind: "ready", text: `Ready. Using ${ENV_NAMES[id]} from your environment, ending ${credential.last4}.`, forget: false };
  }
  if (credential !== null && status.keyStore !== null) {
    return { kind: "ready", text: `Ready. Saved in ${STORE_NAMES[status.keyStore]}, ending ${credential.last4}.`, forget: true };
  }
  if (status.keyStore === null) {
    return { kind: "env-only", text: `This computer has no keyring keyloom can save to. Start keyloom with ${ENV_NAMES[id]} set.`, command: provider.command, keyPage: KEY_PAGES[id] };
  }
  return { kind: "paste", note: `keyloom checks the key with ${PROVIDER_NAMES[id]}, then keeps it in ${STORE_NAMES[status.keyStore]}.` };
}

/**
 * Whether a failed save should re-read the status, by the server's code. A refused or malformed key keeps the field open with the
 * reason; these two mean the status changed under the page (an environment key appeared, or the store went away).
 */
export const failureReloads = (code: string | undefined): boolean => code === "key_from_environment" || code === "key_store_unavailable";
