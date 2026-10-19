// `keyloom provider` (D-120, 19#choosing-a-provider): show and switch the active model provider and model.
import type { Command } from "commander";
import {
  PROVIDERS, type ProviderId, type ProviderStatus, chooseNextProvider, isProviderId, providerStatus, UsageError,
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
  })),
});

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
    p.ready ? p.label : p.setup,
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
}

function s_isActive(s: ProviderStatus, id: ProviderId): boolean {
  return s.active?.provider === id;
}
