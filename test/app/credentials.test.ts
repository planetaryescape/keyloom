// The key store behind a pasted API key (D-496): the key never reaches argv, the environment wins, and forget removes it.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Credentials, type KeyStore, type SecretRunner, keychainStore, runSecretCommand, secretCommandRunner, secretServiceStore, systemKeyStore, useCredentials } from "../../src/app/credentials.ts";
import { CodexSignIn, useCodexSignIn } from "../../src/app/codex-signin.ts";
import { defaultAgentModel, providerStatus } from "../../src/app/chat-model.ts";
import { CredentialError } from "../../src/app/errors.ts";
import { forgetProviderKey, saveProviderKey, startCodexSignIn } from "../../src/app/provider-setup.ts";
import { fakeBinDir, withPath } from "../helpers/fake-bin.ts";
import { NO_CODEX } from "../helpers/no-credentials.ts";
import { tempDir } from "../helpers/tmp.ts";

const KEY = "sk-ant-api03-Example_Key-0123456789abcdWXYZ";

/** A runner that records every call and answers like `security` over an in-memory keychain. */
function fakeSecurity() {
  const items = new Map<string, string>();
  const calls: Array<{ command: string; args: readonly string[]; stdin: string | undefined }> = [];
  const run: SecretRunner = async (command, args, stdin) => {
    calls.push({ command, args, stdin });
    const account = (list: readonly string[]) => list[list.indexOf("-a") + 1] ?? "";
    if (args[0] === "find-generic-password") {
      const key = items.get(account(args));
      return key === undefined ? { code: 44, stdout: "" } : { code: 0, stdout: `${key}\n` };
    }
    if (args[0] === "delete-generic-password") return { code: items.delete(account(args)) ? 0 : 44, stdout: "" };
    if (args.join(" ") === "-q -i") {
      const words = [...(stdin ?? "").matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? "");
      // add-generic-password -U -s "keyloom" -a "<provider>" -l "<label>" -w "<key>"
      items.set(words[1] ?? "", words[3] ?? "");
      return { code: 0, stdout: "" };
    }
    return { code: 1, stdout: "" };
  };
  return { run, calls, items };
}

afterEach(() => {
  useCredentials(undefined);
  useCodexSignIn(undefined);
});

describe("the macOS Keychain store", () => {
  test("writes the key through stdin, never argv, and reads it back", async () => {
    const security = fakeSecurity();
    const store = keychainStore(security.run);
    await store.write("anthropic", KEY);
    expect(await store.read("anthropic")).toBe(KEY);
    for (const call of security.calls) expect(call.args.join(" ")).not.toContain(KEY);
    expect(security.calls[0]?.stdin).toContain(`-w "${KEY}"`);
    expect(security.calls[0]?.stdin).toContain(`-s "keyloom" -a "anthropic"`);
  });

  test("a missing item reads as null and forgetting it is not an error", async () => {
    const store = keychainStore(fakeSecurity().run);
    expect(await store.read("openrouter")).toBeNull();
    await store.remove("openrouter");
  });

  test("refuses text that could break the interactive line, before running anything", async () => {
    const security = fakeSecurity();
    const store = keychainStore(security.run);
    await expect(store.write("anthropic", `${KEY}" -w "other`)).rejects.toThrow("doesn't look like an API key");
    await expect(store.write("anthropic", `${KEY}\nadd-generic-password`)).rejects.toThrow();
    expect(security.calls).toHaveLength(0);
  });

  test("a failure's message never carries the command's output", async () => {
    const store = keychainStore(async () => ({ code: 51, stdout: KEY }));
    const error = await store.read("anthropic").catch((err: Error) => err);
    expect(String(error)).not.toContain(KEY);
    expect(String(error)).toContain("51");
  });

  test("the real runner hands the key to the child on stdin, not in its arguments", async () => {
    // A stand-in `security` that writes down its arguments and its stdin, so the process list is what the test checks.
    const log = join(tempDir("keyloom-sec-"), "log");
    const bin = fakeBinDir({ security: `printf '%s\\n' "$*" > "${log}.args"; cat > "${log}.stdin"` });
    await withPath(bin, async () => {
      await keychainStore(runSecretCommand).write("anthropic", KEY);
    });
    expect(readFileSync(`${log}.args`, "utf8").trim()).toBe("-q -i");
    expect(readFileSync(`${log}.stdin`, "utf8")).toContain(KEY);
  });
});

describe("a key-store command that never finishes", () => {
  test("a clear that times out fails Forget instead of reading as nothing to clear", async () => {
    const bin = fakeBinDir({ "secret-tool": "exec sleep 5" });
    await withPath(bin, async () => {
      const error = await secretServiceStore(secretCommandRunner(200)).remove("anthropic").catch((e: unknown) => e);
      expect(String(error)).toContain("did not answer");
    });
  });

  test("a clear killed by a signal fails Forget too", async () => {
    const bin = fakeBinDir({ "secret-tool": "kill -9 $$" });
    await withPath(bin, async () => {
      const error = await secretServiceStore(secretCommandRunner(5_000)).remove("anthropic").catch((e: unknown) => e);
      expect(String(error)).toContain("was stopped");
    });
  });

  test("a silent exit 1 from a clear that finished is still nothing to clear", async () => {
    const bin = fakeBinDir({ "secret-tool": "exit 1" });
    await withPath(bin, async () => {
      await secretServiceStore(secretCommandRunner(5_000)).remove("anthropic");
    });
  });
});

describe("the Secret Service store", () => {
  test("stores from stdin and looks up by service and account", async () => {
    const calls: Array<{ args: readonly string[]; stdin: string | undefined }> = [];
    let stored: string | null = null;
    const store = secretServiceStore(async (_command, args, stdin) => {
      calls.push({ args, stdin });
      if (args[0] === "store") stored = stdin ?? null;
      if (args[0] === "lookup") return stored === null ? { code: 1, stdout: "" } : { code: 0, stdout: stored };
      if (args[0] === "clear") stored = null;
      return { code: 0, stdout: "" };
    });
    await store.write("openrouter", KEY);
    expect(calls[0]?.args).toEqual(["store", "--label=keyloom openrouter API key", "service", "keyloom", "account", "openrouter"]);
    expect(calls[0]?.stdin).toBe(KEY);
    expect(await store.read("openrouter")).toBe(KEY);
    await store.remove("openrouter");
    expect(await store.read("openrouter")).toBeNull();
  });
});

describe("a Secret Service that fails", () => {
  // secret-tool exits 1 for a missing item and for a failure alike; only a failure writes a reason to stderr.
  const unreachable = { code: 1, stdout: "", stderr: "secret-tool: Cannot autolaunch D-Bus without X11 $DISPLAY" };

  test("a failed clear is an error, so forget never reports a key gone that is still there", async () => {
    // The lookup fails for the same reason, so it can't confirm the key is gone either.
    const store = secretServiceStore(async () => unreachable);
    await expect(store.remove("anthropic")).rejects.toThrow("could not remove the key");
    await expect(new Credentials(store).forget("anthropic")).rejects.toThrow("could not remove the key");
  });

  test("a silent exit 1 is nothing to clear or nothing found, and a failed lookup is an error, not an empty store", async () => {
    const missing = secretServiceStore(async () => ({ code: 1, stdout: "", stderr: "" }));
    await missing.remove("anthropic");
    expect(await missing.read("anthropic")).toBeNull();
    expect(await missing.available?.()).toBe(true);
    const down = secretServiceStore(async () => unreachable);
    await expect(down.read("anthropic")).rejects.toThrow("could not be read");
    expect(await down.available?.()).toBe(false);
  });

  test("installed but not running: the app offers the environment, and saving says there is no store", async () => {
    useCredentials(new Credentials(secretServiceStore(async () => unreachable)));
    const dir = tempDir("keyloom-key-");
    const env = { KEYLOOM_CODEX_BIN: NO_CODEX };
    expect((await providerStatus(dir, {}, env)).keyStore).toBeNull();
    await expect(saveProviderKey(dir, "anthropic", KEY, {}, { env, verify: async () => ({ status: "ok" }) })).rejects.toMatchObject({ code: "key_store_unavailable" });
    await expect(forgetProviderKey(dir, "anthropic", {}, env)).rejects.toMatchObject({ code: "key_store_unavailable" });
  });
});

describe("a store read that stalls", () => {
  /** A store whose read of `stalled` never answers, like a locked Keychain waiting on its password prompt. */
  const stalling = (stalled: "anthropic" | "openrouter", key: string | null = null): KeyStore => ({
    kind: "keychain",
    read: (provider) => (provider === stalled ? new Promise<string | null>(() => {}) : Promise.resolve(key)),
    write: async () => {},
    remove: async () => {},
  });
  const soon = <T,>(work: Promise<T>) => Promise.race([work, Bun.sleep(500).then(() => { throw new Error("waited on the stalled read"); })]);

  test("doesn't hold up a key that is in the environment", async () => {
    useCredentials(new Credentials(stalling("openrouter")));
    const model = await soon(defaultAgentModel(tempDir("keyloom-key-"), {}, { ANTHROPIC_API_KEY: KEY, KEYLOOM_CODEX_BIN: NO_CODEX }));
    expect(model.provider).toBe("anthropic");
  });

  test("a named provider reads only its own key", async () => {
    useCredentials(new Credentials(stalling("anthropic", KEY)));
    const model = await soon(defaultAgentModel(tempDir("keyloom-key-"), { provider: "openrouter" }, { KEYLOOM_CODEX_BIN: NO_CODEX }));
    expect(model.provider).toBe("openrouter");
  });
});

describe("which store this computer has", () => {
  test("the Keychain on macOS, secret-tool on Linux when it is installed, none otherwise", () => {
    expect(systemKeyStore({}, "darwin")?.kind).toBe("keychain");
    expect(systemKeyStore({}, "linux", () => "/usr/bin/secret-tool")?.kind).toBe("secret-service");
    expect(systemKeyStore({}, "linux", () => null)).toBeNull();
    expect(systemKeyStore({}, "win32")).toBeNull();
    expect(systemKeyStore({ KEYLOOM_CREDENTIAL_STORE: "none" }, "darwin")).toBeNull();
  });

  test("the test preload turns the store off, so no test reads the developer's Keychain", () => {
    expect(systemKeyStore()).toBeNull();
  });
});

describe("environment over the store", () => {
  test("a stored key fills an unset variable; a set variable wins", async () => {
    const security = fakeSecurity();
    security.items.set("anthropic", KEY);
    const creds = new Credentials(keychainStore(security.run));
    expect((await creds.env({})).ANTHROPIC_API_KEY).toBe(KEY);
    expect((await creds.env({ ANTHROPIC_API_KEY: "from-env" })).ANTHROPIC_API_KEY).toBe("from-env");
    expect(await creds.sources({})).toEqual({ anthropic: { source: "keychain", last4: "WXYZ" }, openrouter: null });
    expect((await creds.sources({ ANTHROPIC_API_KEY: "sk-env-1234" })).anthropic).toEqual({ source: "environment", last4: "1234" });
  });

  test("forget removes the key and the next read sees it gone", async () => {
    const security = fakeSecurity();
    const creds = new Credentials(keychainStore(security.run));
    await creds.save("anthropic", KEY);
    expect((await creds.env({})).ANTHROPIC_API_KEY).toBe(KEY);
    await creds.forget("anthropic");
    expect(security.items.has("anthropic")).toBe(false);
    expect((await creds.env({})).ANTHROPIC_API_KEY).toBeUndefined();
  });

  test("a read is cached briefly, then read again so a key saved elsewhere arrives", async () => {
    const security = fakeSecurity();
    let now = 0;
    const creds = new Credentials(keychainStore(security.run), () => now);
    expect((await creds.env({})).ANTHROPIC_API_KEY).toBeUndefined();
    security.items.set("anthropic", KEY);
    expect((await creds.env({})).ANTHROPIC_API_KEY).toBeUndefined();
    now = 6_000;
    expect((await creds.env({})).ANTHROPIC_API_KEY).toBe(KEY);
  });
});

describe("saving a key from the app", () => {
  const env = { KEYLOOM_CODEX_BIN: NO_CODEX };

  test("checks it, saves it, and the next model comes from it with no restart", async () => {
    const security = fakeSecurity();
    useCredentials(new Credentials(keychainStore(security.run)));
    const dir = tempDir("keyloom-key-");
    expect((await providerStatus(dir, {}, env)).active).toBeNull();
    const checked: string[] = [];
    const saved = await saveProviderKey(dir, "anthropic", `  ${KEY}\n`, {}, { env, verify: async (_p, e) => (checked.push(e.ANTHROPIC_API_KEY ?? ""), { status: "ok" }) });
    expect(checked).toEqual([KEY]);
    expect(saved.checked).toBe(true);
    expect(saved.status.active?.provider).toBe("anthropic");
    expect(saved.status.keyStore).toBe("keychain");
    const anthropic = saved.status.providers.find((p) => p.id === "anthropic");
    expect(anthropic).toMatchObject({ ready: true, credential: { source: "keychain", last4: "WXYZ" } });
    // The status the browser gets holds the last four characters only.
    expect(JSON.stringify(saved.status)).not.toContain(KEY);
    expect((await defaultAgentModel(dir, {}, env)).provider).toBe("anthropic");
  });

  test("a refused key is not saved, and the error names the provider without the key", async () => {
    const security = fakeSecurity();
    useCredentials(new Credentials(keychainStore(security.run)));
    const error = await saveProviderKey(tempDir("keyloom-key-"), "openrouter", KEY, {}, { env, verify: async () => ({ status: "rejected", reason: "invalid x-api-key" }) }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(CredentialError);
    expect((error as CredentialError).code).toBe("key_rejected");
    expect((error as CredentialError).message).toBe("OpenRouter refused this key.");
    expect(security.items.size).toBe(0);
  });

  test("a key that can't be checked (no network) is saved and says so", async () => {
    useCredentials(new Credentials(keychainStore(fakeSecurity().run)));
    const saved = await saveProviderKey(tempDir("keyloom-key-"), "anthropic", KEY, {}, { env, verify: async () => ({ status: "unchecked", reason: "offline" }) });
    expect(saved.checked).toBe(false);
  });

  test("refuses when the environment already sets the key, when the paste isn't a key, and when there is no store", async () => {
    useCredentials(new Credentials(keychainStore(fakeSecurity().run)));
    const dir = tempDir("keyloom-key-");
    const verify = async () => ({ status: "ok" as const });
    await expect(saveProviderKey(dir, "anthropic", KEY, {}, { env: { ...env, ANTHROPIC_API_KEY: "x" }, verify })).rejects.toMatchObject({ code: "key_from_environment" });
    await expect(saveProviderKey(dir, "anthropic", "my key is here", {}, { env, verify })).rejects.toMatchObject({ code: "key_malformed" });
    useCredentials(new Credentials(null));
    await expect(saveProviderKey(dir, "anthropic", KEY, {}, { env, verify })).rejects.toMatchObject({ code: "key_store_unavailable" });
  });

  test("forgetting takes the provider back to needing setup", async () => {
    const security = fakeSecurity();
    useCredentials(new Credentials(keychainStore(security.run)));
    const dir = tempDir("keyloom-key-");
    await saveProviderKey(dir, "anthropic", KEY, {}, { env, verify: async () => ({ status: "ok" }) });
    const status = await forgetProviderKey(dir, "anthropic", {}, env);
    expect(status.active).toBeNull();
    expect(status.providers.find((p) => p.id === "anthropic")).toMatchObject({ ready: false, credential: null });
  });
});

describe("signing in to Codex from the app", () => {
  /** A `codex` whose `login` prints the sign-in page, waits for a file, and then counts as signed in. */
  function codexBin() {
    const dir = tempDir("keyloom-codex-");
    const done = join(dir, "signed-in");
    const go = join(dir, "go");
    const bin = fakeBinDir({
      codex: `if [ "$1 $2" = "login status" ]; then [ -f "${done}" ] && { echo "Logged in using ChatGPT" >&2; exit 0; }; echo "Not logged in" >&2; exit 1; fi
if [ "$1" = "login" ]; then echo "Starting local login server on http://localhost:1455."; echo "If your browser did not open, navigate to this URL: https://auth.openai.com/oauth/authorize?client_id=x&state=y"; while [ ! -f "${go}" ]; do sleep 0.05; done; touch "${done}"; exit 0; fi
exit 2`,
    });
    return { codex: join(bin, "codex"), go };
  }

  test("runs codex login, shows the sign-in page while it waits, and is ready when it ends", async () => {
    const { codex, go } = codexBin();
    useCodexSignIn(new CodexSignIn());
    useCredentials(new Credentials(null));
    const dir = tempDir("keyloom-codex-data-");
    const env = { KEYLOOM_CODEX_BIN: codex };
    const before = await providerStatus(dir, {}, env);
    expect(before.providers.find((p) => p.id === "codex")).toMatchObject({ ready: false, installed: true });
    expect((await startCodexSignIn(dir, {}, env)).codexSignIn.state).toBe("waiting");
    for (let i = 0; i < 100 && (await providerStatus(dir, {}, env)).codexSignIn.state === "waiting" && !existsSync(go); i++) {
      const s = (await providerStatus(dir, {}, env)).codexSignIn;
      if (s.state === "waiting" && s.url !== null) {
        expect(s.url).toBe("https://auth.openai.com/oauth/authorize?client_id=x&state=y");
        writeFileSync(go, "");
      }
      await Bun.sleep(20);
    }
    for (let i = 0; i < 100 && (await providerStatus(dir, {}, env)).codexSignIn.state === "waiting"; i++) await Bun.sleep(20);
    const after = await providerStatus(dir, {}, env);
    expect(after.codexSignIn).toEqual({ state: "idle" });
    expect(after.active?.provider).toBe("codex");
  });

  test("cancel stops the waiting login", async () => {
    const { codex } = codexBin();
    const signIn = new CodexSignIn();
    expect(signIn.start({ KEYLOOM_CODEX_BIN: codex }).state).toBe("waiting");
    signIn.cancel();
    expect(signIn.current()).toEqual({ state: "idle" });
  });

  test("a codex that isn't installed is reported, so the app hides the button", async () => {
    useCredentials(new Credentials(null));
    const status = await providerStatus(tempDir("keyloom-codex-data-"), {}, { KEYLOOM_CODEX_BIN: NO_CODEX });
    expect(status.providers.find((p) => p.id === "codex")?.installed).toBe(false);
    await expect(startCodexSignIn(tempDir("keyloom-codex-data-"), {}, { KEYLOOM_CODEX_BIN: NO_CODEX })).rejects.toMatchObject({ code: "codex_missing" });
  });

  test("a login that fails says so", async () => {
    const bin = fakeBinDir({ codex: "exit 1" });
    const signIn = new CodexSignIn();
    signIn.start({ KEYLOOM_CODEX_BIN: join(bin, "codex") });
    for (let i = 0; i < 100 && signIn.current().state === "waiting"; i++) await Bun.sleep(10);
    expect(signIn.current()).toEqual({ state: "failed", reason: "Codex didn't finish signing in." });
  });
});
