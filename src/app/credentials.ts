// Where a pasted API key is kept (D-496): the macOS Keychain, or the Secret Service (libsecret) on Linux. The
// environment still wins, so `op run -- keyloom …` behaves as before; a stored key only fills a variable that is unset.
// The key never goes into argv, where any process can read it: `security -i` and `secret-tool store` read it from stdin.
import { spawn } from "node:child_process";

type Env = Record<string, string | undefined>;

export type KeyProvider = "anthropic" | "openrouter";
export const KEY_PROVIDERS: readonly KeyProvider[] = ["anthropic", "openrouter"];
export const KEY_ENV: Record<KeyProvider, string> = { anthropic: "ANTHROPIC_API_KEY", openrouter: "OPENROUTER_API_KEY" };
export const isKeyProvider = (value: unknown): value is KeyProvider => KEY_PROVIDERS.includes(value as KeyProvider);

/** Runs a store's command. `stdin` is written and closed; the key only ever travels this way or comes back on stdout. */
export type SecretRunner = (command: string, args: readonly string[], stdin?: string) => Promise<{ code: number; stdout: string }>;

export type StoreKind = "keychain" | "secret-service";

export interface KeyStore {
  readonly kind: StoreKind;
  read(provider: KeyProvider): Promise<string | null>;
  write(provider: KeyProvider, key: string): Promise<void>;
  /** False when there was nothing stored. */
  remove(provider: KeyProvider): Promise<boolean>;
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

export const runSecretCommand: SecretRunner = (command, args, stdin) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ["pipe", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.once("error", (err: NodeJS.ErrnoException) => reject(new KeyStoreError(err.code === "ENOENT" ? `${command} is not installed` : `${command} could not start`)));
    child.once("close", (code) => resolve({ code: code ?? 1, stdout }));
    child.stdin.end(stdin ?? "");
  });

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
      if (out.code === 44) return false;
      if (out.code !== 0) throw new KeyStoreError(`the Keychain could not remove the key (security exited ${out.code})`);
      return true;
    },
  };
}

/** Linux: the Secret Service through `secret-tool`, which reads the secret from stdin. */
export function secretServiceStore(run: SecretRunner = runSecretCommand): KeyStore {
  const attrs = (provider: KeyProvider) => ["service", SERVICE, "account", provider];
  const read = async (provider: KeyProvider): Promise<string | null> => {
    const out = await run("secret-tool", ["lookup", ...attrs(provider)]);
    // secret-tool exits 1 both for "not found" and for a failure, and says nothing on stdout either way.
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
      const had = (await read(provider)) !== null;
      const out = await run("secret-tool", ["clear", ...attrs(provider)]);
      if (out.code !== 0 && had) throw new KeyStoreError(`the Secret Service could not remove the key (secret-tool exited ${out.code})`);
      return had;
    },
  };
}

/**
 * The store this machine has, or null when there is none (Windows, or Linux without secret-tool). KEYLOOM_CREDENTIAL_STORE=none
 * turns it off: the test preload sets it, so no test reads the developer's own Keychain.
 */
export function systemKeyStore(env: Env = process.env, platform: NodeJS.Platform = process.platform, which: (bin: string) => string | null = (bin) => Bun.which(bin)): KeyStore | null {
  if (env.KEYLOOM_CREDENTIAL_STORE?.trim() === "none") return null;
  if (platform === "darwin") return keychainStore();
  if (platform === "linux" && which("secret-tool") !== null) return secretServiceStore();
  return null;
}

export type CredentialSource = { source: "environment" | StoreKind; last4: string };

const last4 = (key: string): string => key.slice(-4);
const envKey = (env: Env, provider: KeyProvider): string | undefined => env[KEY_ENV[provider]]?.trim() || undefined;

/** How long a read of the store is trusted. Short, so a key saved by the CLI reaches a running server soon after. */
const CACHE_MS = 5_000;

export class Credentials {
  private readonly cache = new Map<KeyProvider, { key: string | null; at: number }>();

  constructor(readonly store: KeyStore | null, private readonly now: () => number = Date.now) {}

  private async stored(provider: KeyProvider): Promise<string | null> {
    if (this.store === null) return null;
    const hit = this.cache.get(provider);
    if (hit && this.now() - hit.at < CACHE_MS) return hit.key;
    let key: string | null;
    try {
      key = await this.store.read(provider);
    } catch (err) {
      // An unreadable store is the same as an empty one for choosing a provider; saving still reports its own failure.
      console.error(`keyloom: ${err instanceof Error ? err.message : "the key store could not be read"}`);
      key = null;
    }
    this.cache.set(provider, { key, at: this.now() });
    return key;
  }

  /** `env` with each unset key variable filled from the store. A variable that is set always wins. */
  async env(env: Env = process.env): Promise<Env> {
    if (this.store === null) return env;
    const filled: Env = { ...env };
    for (const provider of KEY_PROVIDERS) {
      if (envKey(env, provider)) continue;
      const key = await this.stored(provider);
      if (key) filled[KEY_ENV[provider]] = key;
    }
    return filled;
  }

  /** Where each provider's key comes from, with its last four characters only. */
  async sources(env: Env = process.env): Promise<Record<KeyProvider, CredentialSource | null>> {
    const out = {} as Record<KeyProvider, CredentialSource | null>;
    for (const provider of KEY_PROVIDERS) {
      const fromEnv = envKey(env, provider);
      if (fromEnv) {
        out[provider] = { source: "environment", last4: last4(fromEnv) };
        continue;
      }
      const key = this.store === null ? null : await this.stored(provider);
      out[provider] = key && this.store ? { source: this.store.kind, last4: last4(key) } : null;
    }
    return out;
  }

  async save(provider: KeyProvider, key: string): Promise<CredentialSource> {
    if (this.store === null) throw new KeyStoreError("this computer has no key store keyloom can use");
    await this.store.write(provider, key);
    this.cache.set(provider, { key, at: this.now() });
    return { source: this.store.kind, last4: last4(key) };
  }

  async forget(provider: KeyProvider): Promise<boolean> {
    if (this.store === null) return false;
    const removed = await this.store.remove(provider);
    this.cache.set(provider, { key: null, at: this.now() });
    return removed;
  }
}

let shared: Credentials | undefined;

/** The process's one view of the store, so a key saved through the server is used by the next message without a restart. */
export const credentials = (): Credentials => (shared ??= new Credentials(systemKeyStore()));

/** For tests: swap the store, and put the system's back with `useCredentials(undefined)`. */
export function useCredentials(next: Credentials | undefined): void {
  shared = next;
}
