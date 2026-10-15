// The agent's settings (19#choosing-a-provider). keyloom had no config mechanism, so this is the
// smallest one that fits: an optional JSON file in the data directory, beside the database it
// belongs to. Keys never go here (03#model-and-sdk); only which provider and model to use.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { PROVIDERS } from "../agent/provider.ts";
import { UsageError } from "./errors.ts";

export const CONFIG_FILE = "config.json";

const AgentConfigSchema = z.object({
  agent: z.object({
    provider: z.enum(PROVIDERS).optional(),
    model: z.string().min(1).optional(),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  }).strict().default({}),
}).strict();

export type AgentConfig = z.infer<typeof AgentConfigSchema>["agent"];

/** A missing file is the normal case. A malformed one is BK's mistake to fix, so it is a UsageError that names the file. */
export function readAgentConfig(dataDir: string): AgentConfig {
  const path = join(dataDir, CONFIG_FILE);
  if (!existsSync(path)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new UsageError(`${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = AgentConfigSchema.safeParse(raw);
  if (!parsed.success) throw new UsageError(`${path} is not a valid keyloom config: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return parsed.data.agent;
}
