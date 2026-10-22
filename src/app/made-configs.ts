// The configs an agent turn made (put_config, create_config), for the CLI to name. The web reads the same operations from the
// presentation it streams (src/web/configs/agent-made-configs.ts); both rely on the references the observer records per operation
// (src/agent/observation.ts), so neither parses the agent's words.
import { listPresentations } from "../persistence/chat-presentations.ts";
import type { App } from "./context.ts";
import { listConfigs, type ConfigView } from "./configs.ts";

const MAKERS = new Set(["put_config", "create_config"]);

/** The configs the turn that began at `userMessageId` made, in the order the agent called the tools, that still exist. */
export function configsMadeInTurn(app: App, conversationId: string, userMessageId: string): ConfigView[] {
  const presentation = listPresentations(app.db, conversationId).find((p) => p.userMessageId === userMessageId);
  if (presentation === undefined) return [];
  const ids = new Set(presentation.operations.filter((o) => MAKERS.has(o.tool)).flatMap((o) => o.references.filter((r) => r.kind === "config").map((r) => r.id)));
  const existing = new Map(listConfigs(app, { includeArchived: true }).map((c) => [c.id, c]));
  return [...ids].flatMap((id) => existing.get(id) ?? []);
}
