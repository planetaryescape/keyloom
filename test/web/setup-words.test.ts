// What the model setup offers for each provider (D-496), from the status alone.
import { describe, expect, test } from "bun:test";
import type { ChatProviderStatus } from "../../src/api/http.ts";
import { failureReloads, setupView } from "../../src/web/chat/setup-words.ts";

type Provider = ChatProviderStatus["providers"][number];
const base = { label: "x", defaultModel: "m", setup: "s", installed: true, credential: null, ready: false } as const;
const anthropic: Provider = { ...base, id: "anthropic", command: "ANTHROPIC_API_KEY=<your key> keyloom serve" };
const codex: Provider = { ...base, id: "codex", command: "codex login" };
const idle = { keyStore: "keychain" as const, codexSignIn: { state: "idle" as const } };

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
