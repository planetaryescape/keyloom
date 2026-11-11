// `keyloom provider` (D-120, 19#choosing-a-provider): show and switch the active model provider and model, and save or forget an
// API key in the system key store (D-496).
import type { Command } from "commander";
import {
  KEY_PROVIDERS, PROVIDERS, type ProviderId, type ProviderStatus, chooseNextProvider, forgetProviderKey, isKeyProvider, isProviderId, providerStatus,
  saveProviderKey, UsageError,
} from "../../app/index.ts";
import { SCHEMA_VERSION, columns, print } from "../output.ts";
import type { CliContext } from "./context.ts";

const statusJson = (s: ProviderStatus) => ({
  active: s.active && { provider: s.active.provider, model: s.active.model, effort: s.active.effort },
  locked_by: s.lockedBy,
  providers: s.providers.map((p) => ({
    id: p.id,
    label: p.label,
    ready: p.ready,
    default_model: p.defaultModel,
    setup: p.setup,
    command: p.command,
    // Where the key comes from: "environment", "keychain" or "secret-service", with its last four characters. Never the key.
    credential: p.credential,
  })),
  key_store: s.keyStore,
});

const SOURCE_WORDS = { environment: "from the environment", keychain: "saved in the Keychain", "secret-service": "saved in the system keyring" } as const;

function credentialWords(p: ProviderStatus["providers"][number]): string {
  if (p.credential) return `${SOURCE_WORDS[p.credential.source]}, ending ${p.credential.last4}`;
  return p.ready ? p.label : p.setup;
}

function statusTable(s: ProviderStatus): string {
  const lines: string[] = [];
  if (s.active) {
    const lock = s.lockedBy ? ` (locked by ${s.lockedBy})` : "";
    lines.push(`Active provider: ${s.active.provider} (model: ${s.active.model}, effort: ${s.active.effort})${lock}`);
  } else {
    lines.push("No active provider is set up.");
  }
  lines.push("", "Available providers:");
  const rows = s.providers.map((p) => [
    p.id,
    p.ready ? "ready" : "needs setup",
    p.defaultModel,
    credentialWords(p),
  ]);
  lines.push(columns([["PROVIDER", "STATUS", "DEFAULT MODEL", "SETUP / CREDENTIAL"], ...rows]));
  return lines.join("\n");
}

export function registerProviderCommands(program: Command, ctx: CliContext & { quiet: () => boolean }): void {
  const { io, format, quiet, withApp } = ctx;
  const provider = program.command("provider").description("show and switch the model provider (anthropic, openrouter, codex)");

  provider
    .command("status", { isDefault: true })
    .description("show the configured model provider, model, and availability of all providers")
    .option("--json", "print JSON, whatever the output format")
    .action(async (opts: { json?: boolean }) => {
      const status = await withApp((app) => providerStatus(app.dataDir));
      const fmt = opts.json ? "json" : format();
      print(io, fmt, {
        json: statusJson(status),
        rows: status.providers.map((p) => ({
          schema_version: SCHEMA_VERSION,
          id: p.id,
          active: s_isActive(status, p.id),
          ready: p.ready,
          default_model: p.defaultModel,
        })),
        ids: status.active ? [status.active.provider] : [],
        table: quiet() ? (status.active?.provider ?? "none") : statusTable(status),
      });
    });

  provider
    .command("use")
    .description("set the default provider and optional model in config.json")
    .argument("<provider>", `the provider to use: ${PROVIDERS.join(", ")}`)
    .option("--model <model>", "optional model ID to configure for this provider")
    .option("--json", "print JSON, whatever the output format")
    .action(async (providerArg: string, opts: { model?: string; json?: boolean }) => {
      if (!isProviderId(providerArg)) {
        throw new UsageError(`unknown provider "${providerArg}"; choose one of ${PROVIDERS.join(", ")}`);
      }
      const providerId = providerArg as ProviderId;
      const status = await withApp((app) => chooseNextProvider(app.dataDir, { provider: providerId, model: opts.model }));
      const fmt = opts.json ? "json" : format();
      print(io, fmt, {
        json: statusJson(status),
        ids: [providerId],
        table: quiet()
          ? providerId
          : `Saved ${providerId}${opts.model ? ` (model: ${opts.model})` : ""} as default provider in config.json.`,
      });
    });

  const key = provider.command("key").description("save or forget an API key in the system key store (the environment still wins)");
  key
    .command("set")
    .description("check the key piped on stdin with the provider, then save it in the Keychain or system keyring")
    .argument("<provider>", `the provider the key is for: ${KEY_PROVIDERS.join(", ")}`)
    .option("--json", "print JSON, whatever the output format")
    .action(async (providerArg: string, opts: { json?: boolean }) => {
      if (!isKeyProvider(providerArg)) throw new UsageError(`"${providerArg}" takes no API key; choose one of ${KEY_PROVIDERS.join(", ")}`);
      const pasted = await readPipedKey(io, providerArg);
      const saved = await withApp((app) => saveProviderKey(app.dataDir, providerArg, pasted));
      const credential = saved.status.providers.find((p) => p.id === providerArg)?.credential;
      print(io, opts.json ? "json" : format(), {
        json: { ...statusJson(saved.status), checked: saved.checked },
        ids: [providerArg],
        table: quiet()
          ? providerArg
          : `Saved the ${providerArg} key${credential ? ` ending ${credential.last4}` : ""}.${saved.checked ? "" : ` keyloom couldn't reach ${providerArg} to check it.`}`,
      });
    });
  key
    .command("forget")
    .description("remove a key keyloom saved; a key in the environment is untouched")
    .argument("<provider>", `the provider: ${KEY_PROVIDERS.join(", ")}`)
    .option("--json", "print JSON, whatever the output format")
    .action(async (providerArg: string, opts: { json?: boolean }) => {
      if (!isKeyProvider(providerArg)) throw new UsageError(`"${providerArg}" takes no API key; choose one of ${KEY_PROVIDERS.join(", ")}`);
      const status = await withApp((app) => forgetProviderKey(app.dataDir, providerArg));
      print(io, opts.json ? "json" : format(), {
        json: statusJson(status),
        ids: [providerArg],
        table: quiet() ? providerArg : `Forgot the saved ${providerArg} key.`,
      });
    });
}

/** A key piped in on stdin: never an argument, where `ps` and shell history would show it. */
async function readPipedKey(io: CliContext["io"], provider: string): Promise<string> {
  const stdin = io.stdin ?? { isTTY: Boolean(process.stdin.isTTY), text: () => Bun.stdin.text() };
  // The example names the provider being set up, so it can be pasted as it is (R3-25).
  if (stdin.isTTY) throw new UsageError(`pipe the key in, so it isn't shown or kept in your history, for example: pbpaste | keyloom provider key set ${provider}`);
  const key = (await stdin.text()).trim();
  if (key === "") throw new UsageError("no key arrived on standard input");
  return key;
}

function s_isActive(s: ProviderStatus, id: ProviderId): boolean {
  return s.active?.provider === id;
}
