// What the model setup offers for each provider (D-496), from the status alone.
import { describe, expect, test } from "bun:test";
import type { ChatProviderStatus } from "../../src/api/http.ts";
import { CODEX_INSTALL_PAGE, failureReloads, lockWords, setupLead, setupProviders, setupView, storeFallback } from "../../src/web/chat/setup-words.ts";

type Provider = ChatProviderStatus["providers"][number];
const base = { label: "x", defaultModel: "m", setup: "s", installed: true, credential: null, ready: false } as const;
const anthropic: Provider = { ...base, id: "anthropic", command: "ANTHROPIC_API_KEY=<your key> keyloom serve" };
const codex: Provider = { ...base, id: "codex", command: "codex login" };
const idle = { keyStore: "keychain" as const, codexSignIn: { state: "idle" as const }, lockedBy: null, active: null };

describe("the setup for a key provider", () => {
  test("no key and a Keychain: a field to paste into", () => {
    expect(setupView(anthropic, idle)).toEqual({ kind: "paste", note: "keyloom checks the key with Anthropic, then keeps it in your Keychain." });
  });

  test("a saved key can be forgotten; one from the environment can't", () => {
    expect(setupView({ ...anthropic, ready: true, credential: { source: "keychain", last4: "WXYZ" } }, idle)).toEqual({ kind: "ready", text: "Ready. Saved in your Keychain, ending WXYZ.", forget: true });
    expect(setupView({ ...anthropic, ready: true, credential: { source: "environment", last4: "1234" } }, idle)).toEqual({
      kind: "ready", text: "Ready. Using ANTHROPIC_API_KEY from your environment, ending 1234.", forget: false,
    });
  });

  test("no key store on this computer: the environment variable, to copy", () => {
    const view = setupView(anthropic, { ...idle, keyStore: null });
    expect(view).toMatchObject({ kind: "env-only", command: "ANTHROPIC_API_KEY=<your key> keyloom serve" });
  });
});

describe("the setup for Codex", () => {
  test("installed and signed out: the sign-in button; not installed: nothing", () => {
    expect(setupView(codex, idle)).toMatchObject({ kind: "codex-sign-in", failed: null });
    expect(setupView({ ...codex, installed: false }, idle)).toEqual({ kind: "hidden" });
  });

  test("waiting shows the sign-in page; a failure keeps the button with the reason", () => {
    expect(setupView(codex, { ...idle, codexSignIn: { state: "waiting", url: "https://auth.openai.com/x" } })).toEqual({ kind: "codex-waiting", url: "https://auth.openai.com/x" });
    expect(setupView(codex, { ...idle, codexSignIn: { state: "failed", reason: "Codex didn't finish signing in." } })).toMatchObject({ kind: "codex-sign-in", failed: "Codex didn't finish signing in." });
    expect(setupView({ ...codex, ready: true }, idle)).toMatchObject({ kind: "ready", forget: false });
  });
});

describe("a failed save", () => {
  test("a refused or malformed key keeps the field; a changed status is re-read", () => {
    expect(failureReloads("key_rejected")).toBe(false);
    expect(failureReloads("key_malformed")).toBe(false);
    expect(failureReloads("key_from_environment")).toBe(true);
    expect(failureReloads("key_store_unavailable")).toBe(true);
  });
});

describe("a key the provider turned down", () => {
  test("from the environment: not Ready, and says which variable to change", () => {
    const fromEnv: Provider = { ...anthropic, ready: true, credential: { source: "environment", last4: "1234" } };
    expect(setupView(fromEnv, idle, true)).toEqual({
      kind: "env-only",
      text: "Anthropic didn't accept ANTHROPIC_API_KEY from your environment, ending 1234. Start keyloom again with another key in ANTHROPIC_API_KEY.",
      command: "ANTHROPIC_API_KEY=<your key> keyloom serve",
      keyPage: "https://console.anthropic.com/settings/keys",
    });
    expect(setupView(fromEnv, idle).kind).toBe("ready");
  });

  test("saved by keyloom: still the saved key, which Replace the key opens over", () => {
    expect(setupView({ ...anthropic, ready: true, credential: { source: "keychain", last4: "WXYZ" } }, idle, true)).toMatchObject({ kind: "ready", forget: true });
  });
});

// R2-04, R2-12: a lock shows one provider, and the words offer only what this computer has.
describe("a provider fixed by KEYLOOM_PROVIDER or --provider", () => {
  const openrouter: Provider = { ...base, id: "openrouter", command: "OPENROUTER_API_KEY=<your key> keyloom serve" };
  const status = (over: Partial<ChatProviderStatus> = {}): ChatProviderStatus => ({
    active: null, lockedBy: null, keyStore: "keychain", codexSignIn: { state: "idle" }, providers: [anthropic, openrouter, codex], ...over,
  });
  const lockedTo = (provider: Provider["id"], over: Partial<ChatProviderStatus> = {}) =>
    status({ lockedBy: "KEYLOOM_PROVIDER", active: { provider, model: "m", effort: "e" }, ...over });

  test("the setup lists only the locked provider, and says why", () => {
    expect(setupProviders(lockedTo("codex")).map((p) => p.id)).toEqual(["codex"]);
    expect(setupProviders(lockedTo("openrouter"), ["anthropic"]).map((p) => p.id)).toEqual(["openrouter"]);
    expect(lockWords(lockedTo("codex"))).toBe("keyloom was started with KEYLOOM_PROVIDER, so only Codex answers.");
    expect(lockWords(lockedTo("anthropic", { lockedBy: "--provider" }))).toBe("keyloom was started with --provider, so only Anthropic answers.");
  });

  test("with no lock, every provider (or the ones asked for) and no lock words", () => {
    expect(setupProviders(status()).map((p) => p.id)).toEqual(["anthropic", "openrouter", "codex"]);
    expect(setupProviders(status(), ["openrouter"]).map((p) => p.id)).toEqual(["openrouter"]);
    expect(lockWords(status({ active: { provider: "codex", model: "m", effort: "e" } }))).toBeNull();
  });

  test("Codex locked but not installed links to its install page instead of hiding", () => {
    const missing = { ...codex, installed: false };
    expect(setupView(missing, lockedTo("codex"))).toMatchObject({ kind: "codex-install", page: CODEX_INSTALL_PAGE });
    expect(setupView(missing, lockedTo("anthropic"))).toEqual({ kind: "hidden" });
  });

  test("the lead never offers a Codex sign-in that isn't there", () => {
    const noCodex = [anthropic, openrouter, { ...codex, installed: false }];
    expect(setupLead(status())).toBe("Paste an API key, or sign in with Codex. Chat can use it straight away.");
    expect(setupLead(status({ providers: noCodex }))).toBe("Paste an API key. Chat can use it straight away.");
    expect(setupLead(status({ providers: noCodex, keyStore: null }))).toBe("Start keyloom with an API key set.");
    expect(setupLead(lockedTo("codex", { providers: noCodex }))).toBe("Chat answers with Codex, which needs installing first.");
    expect(setupLead(lockedTo("codex"))).toBe("Sign in with Codex, and chat can use it straight away.");
    expect(setupLead(lockedTo("anthropic"))).toBe("Paste an Anthropic API key, and chat can use it straight away.");
  });
});

// R2-16: a key store that refuses has a way round it that doesn't need the store.
describe("when the key store refuses", () => {
  test("the desktop app is told to put the variable in the shell profile and reopen", () => {
    const fallback = storeFallback("anthropic", true);
    expect(fallback.command).toBe("export ANTHROPIC_API_KEY=<your key>");
    expect(fallback.text).toContain("quit keyloom and open it again");
  });

  test("a browser tab is given the serve command with the variable", () => {
    expect(storeFallback("openrouter", false).command).toBe("OPENROUTER_API_KEY=<your key> keyloom serve");
  });
});
