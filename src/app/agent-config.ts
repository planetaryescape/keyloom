// The agent's settings (19#choosing-a-provider). keyloom had no config mechanism, so this is the
// smallest one that fits: an optional JSON file in the data directory, beside the database it
// belongs to. Keys never go here (03#model-and-sdk); only which provider and model to use.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { PROVIDERS, type ProviderId } from "../agent/provider.ts";
import { UsageError } from "./errors.ts";

export const CONFIG_FILE = "config.json";

const AgentConfigSchema = z.object({
  server: z.object({
    port: z.number().int().min(1).max(65535).optional(),
  }).strict().optional(),
  agent: z.object({
    provider: z.enum(PROVIDERS).optional(),
    model: z.string().min(1).optional(),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  }).strict().default({}),
}).strict();

export type AgentConfig = z.infer<typeof AgentConfigSchema>["agent"];

/** A missing file is the normal case. A malformed one is BK's mistake to fix, so it is a UsageError that names the file. */
function readConfig(dataDir: string): z.infer<typeof AgentConfigSchema> {
  const path = join(dataDir, CONFIG_FILE);
  if (!existsSync(path)) return { agent: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new UsageError(`${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = AgentConfigSchema.safeParse(raw);
  if (!parsed.success) throw new UsageError(`${path} is not a valid keyloom config: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return parsed.data;
}

export function readAgentConfig(dataDir: string): AgentConfig {
  return readConfig(dataDir).agent;
}

/**
 * Saves the provider and model the next conversation starts on (19#choosing-a-provider). Other settings in the
 * file stay as they are; a file keyloom can't read is left alone and reported, since overwriting it would lose
 * whatever BK wrote there. The write goes through a rename so a reader never sees half a file.
 */
export function writeAgentConfig(dataDir: string, choice: { provider: ProviderId; model?: string | undefined }): AgentConfig {
  const current = readConfig(dataDir);
  const agent: AgentConfig = { ...current.agent, provider: choice.provider };
  if (choice.model === undefined) delete agent.model;
  else agent.model = choice.model;
  const path = join(dataDir, CONFIG_FILE);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ ...current, agent }, null, 2)}\n`);
  renameSync(temporary, path);
  return agent;
}
