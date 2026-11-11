// Setting up a model provider from the app or the CLI (D-496): save a pasted key in the system key store after one check,
// forget it, or run `codex login`. Each returns the status the next message sees, so nothing needs a restart.
import { checkCodexLogin } from "../agent/codex/login.ts";
import { type ModelChoice, type ProviderStatus, providerStatus } from "./chat-model.ts";
import { codexSignIn } from "./codex-signin.ts";
import { type CredentialOutcome, verifyCredential } from "./credential-check.ts";
import { KEY_ENV, KEY_NAMES, type KeyProvider, KeyStoreError, credentials, isKeyShaped } from "./credentials.ts";
import { CredentialError } from "./errors.ts";

type Env = Record<string, string | undefined>;

export type SaveKeyOptions = {
  /** The API read that tells a good key from a refused one; the real one spends no tokens. */
  verify?: (provider: KeyProvider, env: Env) => Promise<CredentialOutcome>;
  env?: Env;
};

/** Runs a store write, turning "no store" and a failed store command into the CredentialError the routes and CLI map. */
async function withKeyStore(verb: "save" | "remove", write: () => Promise<void>): Promise<void> {
  if (credentials().store === null) throw new CredentialError("key_store_unavailable", "This computer has no key store keyloom can use.");
  try {
    await write();
  } catch (err) {
    if (err instanceof KeyStoreError) throw new CredentialError("key_store_failed", `keyloom couldn't ${verb} the key: ${err.message}.`);
    throw err;
  }
}

/**
 * Checks a pasted key with one read, saves it to the key store, and returns the status the next message sees. A refused key
 * is not saved. A key that can't be checked (no network) is saved: the first message says whether it works.
 */
export async function saveProviderKey(dataDir: string, provider: KeyProvider, pasted: string, current: ModelChoice = {}, opts: SaveKeyOptions = {}): Promise<{ status: ProviderStatus; checked: boolean }> {
  const env = opts.env ?? process.env;
  const name = KEY_NAMES[provider];
  let checked = false;
  await withKeyStore("save", async () => {
    if (env[KEY_ENV[provider]]?.trim()) {
      throw new CredentialError("key_from_environment", `${KEY_ENV[provider]} is set where keyloom started, and it outranks a saved key.`);
    }
    const key = pasted.trim();
    if (!isKeyShaped(key)) throw new CredentialError("key_malformed", `That doesn't look like an ${name} key. Copy the whole key and paste it again.`);
    const outcome = await (opts.verify ?? verifyCredential)(provider, { [KEY_ENV[provider]]: key });
    if (outcome.status === "rejected") throw new CredentialError("key_rejected", `${name} refused this key.`);
    checked = outcome.status === "ok";
    await credentials().save(provider, key);
  });
  return { status: await providerStatus(dataDir, current, env), checked };
}

/** Removes a key keyloom saved. A key from the environment is not keyloom's to remove. */
export async function forgetProviderKey(dataDir: string, provider: KeyProvider, current: ModelChoice = {}, env: Env = process.env): Promise<ProviderStatus> {
  await withKeyStore("remove", () => credentials().forget(provider));
  return providerStatus(dataDir, current, env);
}

/** Starts `codex login`, which opens the browser; the status's `codexSignIn` says when it ends. */
export async function startCodexSignIn(dataDir: string, current: ModelChoice = {}, env: Env = process.env): Promise<ProviderStatus> {
  const login = await checkCodexLogin(env);
  if (!login.ready && login.reason === "not_installed") throw new CredentialError("codex_missing", "The Codex CLI is not installed on this computer.");
  if (!login.ready) codexSignIn().start(env);
  return providerStatus(dataDir, current, env);
}

export async function cancelCodexSignIn(dataDir: string, current: ModelChoice = {}, env: Env = process.env): Promise<ProviderStatus> {
  codexSignIn().cancel();
  return providerStatus(dataDir, current, env);
}
