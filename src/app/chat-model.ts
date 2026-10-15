// Where the app gets its model: BK's own key from ANTHROPIC_API_KEY, never stored (03#model-and-sdk).
import { type AgentModel } from "../agent/model.ts";
import { anthropicModel, clientFromEnv } from "../agent/anthropic-model.ts";
import { ModelError } from "./errors.ts";

export function defaultAgentModel(env: Record<string, string | undefined> = process.env): AgentModel {
  const client = clientFromEnv(env);
  if (!client) {
    throw new ModelError(
      "missing_key",
      "ANTHROPIC_API_KEY is not set. keyloom reads your Anthropic key from that environment variable only, for example: op run -- keyloom chat <layout>",
    );
  }
  return anthropicModel(client);
}
