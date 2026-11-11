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

/**
 * Where to get the Codex CLI by hand. Where keyloom can install it (Homebrew on a Mac) the setup offers Install Codex through the
 * install job instead (R3-24); elsewhere a lock to a Codex that isn't installed links here and checks again after.
 */
export const CODEX_INSTALL_PAGE = "https://developers.openai.com/codex/cli";

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
  /** Codex has to answer (it is locked) but its CLI isn't on this computer. `canInstall`: keyloom can install it here. */
  | { kind: "codex-install"; text: string; page: string; canInstall: boolean }
  | { kind: "codex-waiting"; url: string | null };

/**
 * `refused` is true when the provider just turned the key down (a refused key, no credits), so it is no longer shown as Ready.
 * `desktop` is true in the desktop app, which takes the variable from the shell profile when it opens (D-443), so the way to a new
 * variable is the profile line and reopening the app, not a terminal `serve` command (R3-07).
 */
export function setupView(provider: Provider, status: Pick<ChatProviderStatus, "keyStore" | "codexSignIn" | "lockedBy" | "active">, refused = false, desktop = false): SetupView {
  if (provider.id === "codex") {
    if (status.codexSignIn.state === "waiting") return { kind: "codex-waiting", url: status.codexSignIn.url };
    if (provider.ready) return { kind: "ready", text: "Ready. Signed in to Codex with ChatGPT.", forget: false };
    if (!provider.installed) {
      return lockedProvider(status) === "codex"
        ? provider.canInstall
          ? { kind: "codex-install", text: "The Codex CLI isn't installed on this computer. keyloom can install it with Homebrew.", page: CODEX_INSTALL_PAGE, canInstall: true }
          : { kind: "codex-install", text: "The Codex CLI isn't installed on this computer. Install it, then check again here.", page: CODEX_INSTALL_PAGE, canInstall: false }
        : { kind: "hidden" };
    }
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
    const refusedText = `${PROVIDER_NAMES[id]} didn't accept ${ENV_NAMES[id]} from your environment, ending ${credential.last4}.`;
    return desktop
      ? { kind: "env-only", text: `${refusedText} ${profileStep(id)}`, command: profileLine(id), keyPage: KEY_PAGES[id] }
      : { kind: "env-only", text: `${refusedText} Start keyloom again with another key in ${ENV_NAMES[id]}.`, command: provider.command, keyPage: KEY_PAGES[id] };
  }
  if (credential?.source === "environment") {
    return { kind: "ready", text: `Ready. Using ${ENV_NAMES[id]} from your environment, ending ${credential.last4}.`, forget: false };
  }
  if (credential !== null && status.keyStore !== null) {
    return { kind: "ready", text: `Ready. Saved in ${STORE_NAMES[status.keyStore]}, ending ${credential.last4}.`, forget: true };
  }
  if (status.keyStore === null) {
    const none = "This computer has no keyring keyloom can save to.";
    return desktop
      ? { kind: "env-only", text: `${none} ${profileStep(id)}`, command: profileLine(id), keyPage: KEY_PAGES[id] }
      : { kind: "env-only", text: `${none} Start keyloom with ${ENV_NAMES[id]} set.`, command: provider.command, keyPage: KEY_PAGES[id] };
  }
  return { kind: "paste", note: `keyloom checks the key with ${PROVIDER_NAMES[id]}, then keeps it in ${STORE_NAMES[status.keyStore]}.` };
}

// The desktop app's way to set a key: a line in the login shell's profile, read when it opens (D-443).
const profileLine = (id: KeyProvider): string => `export ${ENV_NAMES[id]}=<your key>`;
const profileStep = (id: KeyProvider): string => `Put this line in your shell profile (such as ~/.zshrc), replacing any ${ENV_NAMES[id]} line there, then quit keyloom and open it again.`;

/**
 * The way round a key store that refuses to save (R2-16): keyloom reads the key from its environment variable instead. The desktop
 * app takes that variable from the login shell's profile when it opens (D-443); a terminal `keyloom serve` takes it from its command.
 */
export function storeFallback(id: KeyProvider, desktop: boolean): { text: string; command: string } {
  const name = ENV_NAMES[id];
  return desktop
    ? { text: `If saving keeps failing, keyloom can read the key from ${name}. Add this line to your shell profile (such as ~/.zshrc), then quit keyloom and open it again.`, command: profileLine(id) }
    : { text: `If saving keeps failing, keyloom can read the key from ${name}. Start keyloom with it set:`, command: `${name}=<your key> keyloom serve` };
}

/**
 * Whether a failed save should re-read the status, by the server's code. A refused or malformed key keeps the field open with the
 * reason; these two mean the status changed under the page (an environment key appeared, or the store went away).
 */
export const failureReloads = (code: string | undefined): boolean => code === "key_from_environment" || code === "key_store_unavailable";

type ProviderId = Provider["id"];
type LockFields = Pick<ChatProviderStatus, "lockedBy" | "active">;

/** The provider every message goes to when --provider or KEYLOOM_PROVIDER fixes it (R2-04); null when the picker decides. */
export const lockedProvider = (status: LockFields): ProviderId | null => (status.lockedBy === null ? null : status.active?.provider ?? null);

/** Why only one provider is offered, or null when nothing is locked. */
export function lockWords(status: LockFields): string | null {
  const locked = lockedProvider(status);
  return locked === null || status.lockedBy === null ? null : `keyloom was started with ${status.lockedBy}, so only ${PROVIDER_NAMES[locked]} answers.`;
}

/** The providers a setup list shows: only the locked one when there is a lock, else `only` (or every provider). */
export function setupProviders(status: ChatProviderStatus, only?: readonly ProviderId[]): Provider[] {
  const locked = lockedProvider(status);
  return status.providers.filter((p) => (locked === null ? only === undefined || only.includes(p.id) : p.id === locked));
}

/**
 * The line above the setup when chat has no model, naming only the ways this computer has (R2-12): Codex sign-in only when the
 * Codex CLI is installed, and a pasted key only where there is a keyring to keep it.
 */
export function setupLead(status: ChatProviderStatus | null): string {
  if (status === null) return "Set up a model, and chat can use it straight away.";
  const locked = lockedProvider(status);
  const codex = status.providers.find((p) => p.id === "codex");
  if (locked === "codex") return codex?.installed === false ? "Chat answers with Codex, which needs installing first." : "Sign in with Codex, and chat can use it straight away.";
  const key = status.keyStore === null ? "Start keyloom with an API key set" : "Paste an API key";
  if (locked !== null) return status.keyStore === null ? `Start keyloom with ${PROVIDER_NAMES[locked]}'s API key set.` : `Paste an ${PROVIDER_NAMES[locked]} API key, and chat can use it straight away.`;
  const ways = codex?.installed === false ? key : `${key}, or sign in with Codex`;
  return status.keyStore === null ? `${ways}.` : `${ways}. Chat can use it straight away.`;
}
