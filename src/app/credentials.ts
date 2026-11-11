// Where a pasted API key is kept (D-496): the macOS Keychain, or the Secret Service (libsecret) on Linux. The
// environment still wins, so `op run -- keyloom …` behaves as before; a stored key only fills a variable that is unset.
// The key never goes into argv, where any process can read it: `security -i` and `secret-tool store` read it from stdin.
import type { ProviderId } from "../agent/provider.ts";
import { capture, which } from "../firmware/toolchain/run.ts";

type Env = Record<string, string | undefined>;

export type KeyProvider = "anthropic" | "openrouter";
export const KEY_PROVIDERS: readonly KeyProvider[] = ["anthropic", "openrouter"];
export const KEY_ENV: Record<KeyProvider, string> = { anthropic: "ANTHROPIC_API_KEY", openrouter: "OPENROUTER_API_KEY" };
export const KEY_NAMES: Record<KeyProvider, string> = { anthropic: "Anthropic", openrouter: "OpenRouter" };
export const isKeyProvider = (value: unknown): value is KeyProvider => KEY_PROVIDERS.includes(value as KeyProvider);

/** Runs a store's command. `stdin` is written and closed; the key only ever travels this way or comes back on stdout. */
export type SecretRunner = (command: string, args: readonly string[], stdin?: string) => Promise<{ code: number; stdout: string; stderr?: string }>;

export type StoreKind = "keychain" | "secret-service";

export interface KeyStore {
  readonly kind: StoreKind;
  read(provider: KeyProvider): Promise<string | null>;
  write(provider: KeyProvider, key: string): Promise<void>;
  /** Removing a key that isn't there is not an error. */
  remove(provider: KeyProvider): Promise<void>;
  /** False when the store is installed but can't be reached now. A store without it is always reachable. */
  available?(): Promise<boolean>;
}

/** A store command failed. The message never carries the command's output, which may hold the key. */
export class KeyStoreError extends Error {
  override name = "KeyStoreError";
}

const SERVICE = "keyloom";

/**
 * Keys are the providers' own tokens (`sk-ant-…`, `sk-or-v1-…`). Allowing only these characters keeps a pasted key from
 * breaking the quoted `security -i` line, and turns a stray paste (a sentence, a newline) into a clear error.
 */
const KEY_SHAPE = /^[A-Za-z0-9_.:+/=-]{20,512}$/;
export const isKeyShaped = (key: string): boolean => KEY_SHAPE.test(key);

/** Long enough to type a password into a locked Keychain's prompt; a store that hangs past it reads as empty, not as a stuck chat. */
const STORE_TIMEOUT_MS = 60_000;

export const runSecretCommand: SecretRunner = async (command, args, stdin) => {
  // No `log`: stdout of a read is the key.
  const result = await capture([command, ...args], { ...(stdin === undefined ? {} : { stdin }), timeoutMs: STORE_TIMEOUT_MS }).catch(() => {
    throw new KeyStoreError(`${command} is not installed`);
  });
  return { code: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
};

/** macOS: one generic password per provider, service "keyloom", account = the provider. */
export function keychainStore(run: SecretRunner = runSecretCommand): KeyStore {
  return {
    kind: "keychain",
    async read(provider) {
      const out = await run("security", ["find-generic-password", "-s", SERVICE, "-a", provider, "-w"]);
      // 44 is errSecItemNotFound.
      if (out.code === 44) return null;
      if (out.code !== 0) throw new KeyStoreError(`the Keychain could not be read (security exited ${out.code})`);
      return out.stdout.trim() || null;
    },
    async write(provider, key) {
      if (!isKeyShaped(key)) throw new KeyStoreError("that doesn't look like an API key");
      // Interactive mode reads the command from stdin, so the key is not in this process's arguments.
      const out = await run("security", ["-q", "-i"], `add-generic-password -U -s "${SERVICE}" -a "${provider}" -l "keyloom ${provider} API key" -w "${key}"\n`);
      if (out.code !== 0) throw new KeyStoreError(`the Keychain refused the key (security exited ${out.code})`);
    },
    async remove(provider) {
      const out = await run("security", ["delete-generic-password", "-s", SERVICE, "-a", provider]);
      if (out.code !== 0 && out.code !== 44) throw new KeyStoreError(`the Keychain could not remove the key (security exited ${out.code})`);
    },
  };
}

/** Linux: the Secret Service through `secret-tool`, which reads the secret from stdin. */
export function secretServiceStore(run: SecretRunner = runSecretCommand): KeyStore {
  const attrs = (provider: KeyProvider) => ["service", SERVICE, "account", provider];
  // secret-tool exits 1 both for "not found" and for a failure. Only a failure prints a reason on stderr (libsecret
  // tool/secret-tool.c, secret_tool_action_lookup and _clear), so stderr is what tells them apart.
  const failed = (out: { code: number; stderr?: string }) => out.code !== 0 && Boolean(out.stderr?.trim());
  const read = async (provider: KeyProvider): Promise<string | null> => {
    const out = await run("secret-tool", ["lookup", ...attrs(provider)]);
    if (failed(out)) throw new KeyStoreError(`the Secret Service could not be read (secret-tool exited ${out.code})`);
    if (out.code !== 0) return null;
    return out.stdout.trim() || null;
  };
  return {
    kind: "secret-service",
    read,
    async write(provider, key) {
      if (!isKeyShaped(key)) throw new KeyStoreError("that doesn't look like an API key");
      const out = await run("secret-tool", ["store", `--label=keyloom ${provider} API key`, ...attrs(provider)], key);
      if (out.code !== 0) throw new KeyStoreError(`the Secret Service refused the key (secret-tool exited ${out.code})`);
    },
    async remove(provider) {
      // A silent exit 1 is "nothing to clear"; a failure says why, and the key may still be there.
      const out = await run("secret-tool", ["clear", ...attrs(provider)]);
      if (failed(out)) throw new KeyStoreError(`the Secret Service could not remove the key (secret-tool exited ${out.code})`);
    },
    // secret-tool can be installed where no Secret Service runs (no D-Bus session, no keyring daemon). A lookup finds out.
    available: () => read("anthropic").then(() => true, () => false),
  };
}

/**
 * The store this machine has, or null when there is none (Windows, or Linux without secret-tool). KEYLOOM_CREDENTIAL_STORE=none
 * turns it off: the test preload sets it, so no test reads the developer's own Keychain.
 */
export function systemKeyStore(env: Env = process.env, platform: NodeJS.Platform = process.platform, find: (bin: string) => string | null = which): KeyStore | null {
  if (env.KEYLOOM_CREDENTIAL_STORE?.trim() === "none") return null;
  if (platform === "darwin") return keychainStore();
  if (platform === "linux" && find("secret-tool") !== null) return secretServiceStore();
  return null;
}

export type CredentialSource = { source: "environment" | StoreKind; last4: string };

const last4 = (key: string): string => key.slice(-4);
const envKey = (env: Env, provider: KeyProvider): string | undefined => env[KEY_ENV[provider]]?.trim() || undefined;

/** How long a read of the store is trusted. Short, so a key saved by the CLI reaches a running server soon after. */
const CACHE_MS = 5_000;

export class Credentials {
  // The read itself is cached, so two lookups that start together (status and env) share one `security` run.
  private readonly cache = new Map<KeyProvider, { key: Promise<string | null>; at: number }>();
  private reachable: { ok: Promise<boolean>; at: number } | undefined;

  constructor(readonly store: KeyStore | null, private readonly now: () => number = Date.now) {}

  private stored(provider: KeyProvider): Promise<string | null> {
    const store = this.store;
    if (store === null) return Promise.resolve(null);
    const hit = this.cache.get(provider);
    if (hit && this.now() - hit.at < CACHE_MS) return hit.key;
    const key = store.read(provider).catch((err: unknown) => {
      // An unreadable store is the same as an empty one for choosing a provider; saving still reports its own failure.
      console.error(`keyloom: ${err instanceof Error ? err.message : "the key store could not be read"}`);
      return null;
    });
    this.cache.set(provider, { key, at: this.now() });
    return key;
  }

  /** The store a pasted key can be saved to now; null when there is none, or it is installed but can't be reached. */
  async usableStore(): Promise<StoreKind | null> {
    const store = this.store;
    if (store === null) return null;
    if (store.available === undefined) return store.kind;
    if (this.reachable === undefined || this.now() - this.reachable.at >= CACHE_MS) this.reachable = { ok: store.available(), at: this.now() };
    return (await this.reachable.ok) ? store.kind : null;
  }

  /**
   * `env` filled for the one provider that will answer, so a slow store read for another provider never holds up a key that is
   * already set. With no provider named, the providers are tried in the order the default is picked, stopping at the first key.
   */
  async envFor(env: Env, provider: ProviderId | undefined): Promise<Env> {
    if (this.store === null) return env;
    const order = provider === undefined ? KEY_PROVIDERS : KEY_PROVIDERS.filter((p) => p === provider);
    const first = order.findIndex((p) => envKey(env, p));
    // Everything before the first environment key may be needed, so those reads start together.
    const reads = order.slice(0, first === -1 ? order.length : first).map((p) => ({ provider: p, key: this.stored(p) }));
    for (const read of reads) {
      const key = await read.key;
      if (key) return { ...env, [KEY_ENV[read.provider]]: key };
    }
    return env;
  }

  /** `env` with each unset key variable filled from the store. A variable that is set always wins. */
  async env(env: Env = process.env): Promise<Env> {
    if (this.store === null) return env;
    const filled: Env = { ...env };
    const keys = await Promise.all(KEY_PROVIDERS.map((provider) => (envKey(env, provider) ? null : this.stored(provider))));
    KEY_PROVIDERS.forEach((provider, i) => {
      const key = keys[i];
      if (key) filled[KEY_ENV[provider]] = key;
    });
    return filled;
  }

  /** Where each provider's key comes from, with its last four characters only. */
  async sources(env: Env = process.env): Promise<Record<KeyProvider, CredentialSource | null>> {
    const store = this.store;
    const found = await Promise.all(KEY_PROVIDERS.map(async (provider): Promise<CredentialSource | null> => {
      const fromEnv = envKey(env, provider);
      if (fromEnv) return { source: "environment", last4: last4(fromEnv) };
      const key = store === null ? null : await this.stored(provider);
      return key && store ? { source: store.kind, last4: last4(key) } : null;
    }));
    return Object.fromEntries(KEY_PROVIDERS.map((provider, i) => [provider, found[i] ?? null])) as Record<KeyProvider, CredentialSource | null>;
  }

  async save(provider: KeyProvider, key: string): Promise<void> {
    if (this.store === null) throw new KeyStoreError("this computer has no key store keyloom can use");
    await this.store.write(provider, key);
    this.cache.set(provider, { key: Promise.resolve(key), at: this.now() });
  }

  async forget(provider: KeyProvider): Promise<void> {
    if (this.store === null) return;
    await this.store.remove(provider);
    this.cache.set(provider, { key: Promise.resolve(null), at: this.now() });
  }
}

let shared: Credentials | undefined;

/** The process's one view of the store, so a key saved through the server is used by the next message without a restart. */
export const credentials = (): Credentials => (shared ??= new Credentials(systemKeyStore()));

/** For tests: swap the store, and put the system's back with `useCredentials(undefined)`. */
export function useCredentials(next: Credentials | undefined): void {
  shared = next;
}
