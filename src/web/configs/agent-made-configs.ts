// Which configs a reply made (put_config, create_config), read from the observed presentation: the server records each operation's tool
// and the config it committed (src/agent/observation.ts), so nothing here parses the reply's words. Pure, so the rules that decide when
// a reply opens a config can be tested without React.
import type { ChatPresentation } from "../../api/http.ts";

const MAKERS = new Set(["put_config", "create_config"]);

export type MadeConfig = { id: string; succeeded: boolean };

/** The configs this reply's making operations committed, in the order the agent called them, each once. */
export function madeConfigs(presentation: ChatPresentation | undefined): MadeConfig[] {
  const made = new Map<string, MadeConfig>();
  for (const operation of presentation?.operations ?? []) {
    if (!MAKERS.has(operation.tool)) continue;
    for (const reference of operation.references) {
      if (reference.kind !== "config") continue;
      // A config that was made stays made even when its operation later failed; only a clean finish may open it.
      made.set(reference.id, { id: reference.id, succeeded: operation.status === "succeeded" || made.get(reference.id)?.succeeded === true });
    }
  }
  return [...made.values()];
}

/**
 * The config a finished reply should open: the last one made, and only when the run completed and that making operation succeeded.
 * Stopped, failed, incomplete and unobserved runs leave the card to say what exists.
 */
export function configToOpen(presentation: ChatPresentation | undefined): string | null {
  if (presentation === undefined || presentation.status !== "completed") return null;
  return madeConfigs(presentation).findLast((config) => config.succeeded)?.id ?? null;
}

export type AutoOpenContext = {
  /** The config on screen, which is the one the run started on: a chat belongs to its config's page and ends with it. */
  currentId: string;
  /** Configs this page has already opened for the agent. */
  opened: ReadonlySet<string>;
  /** BK is in the middle of something on this page (a key card, a combo, placing a key, an unsaved draft). */
  busy: boolean;
};

/**
 * The config to open on its own once a reply BK watched finish. Null while he is editing (the card is the offer then, per 28's "do not
 * steal focus"), for a config already opened once, and for the config he is already on.
 */
export function autoOpenTarget(presentation: ChatPresentation | undefined, context: AutoOpenContext): string | null {
  if (context.busy) return null;
  const id = configToOpen(presentation);
  return id === null || id === context.currentId || context.opened.has(id) ? null : id;
}
