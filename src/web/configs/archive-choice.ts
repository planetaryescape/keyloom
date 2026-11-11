// Whether a config can be archived from a page that can't draw it, and what to offer when it can't (R3-06). The server refuses to archive
// the config on a keyboard, because the engine would keep the keyboard on something nobody can see (D-300), so the page doesn't offer it.
import type { ApiConfig } from "../../api/configs.ts";

export type ArchiveChoice =
  | { kind: "archive" }
  /** It is on its keyboard: `putOn` is another config of the board to put on in its place, or null when there is none. */
  | { kind: "on_keyboard"; boardName: string; reason: string; putOn: ApiConfig | null };

/** `configs` are the board's configs; an unknown config (the list failed or is stale) keeps Archive, and the server has the last word. */
export function archiveChoice(configs: readonly ApiConfig[], id: string): ArchiveChoice {
  const config = configs.find((c) => c.id === id);
  if (config === undefined || !config.onKeyboard) return { kind: "archive" };
  // The most recently changed one is the likeliest to be wanted; the header's switcher reaches the rest.
  const putOn = configs.filter((c) => c.id !== id && c.archivedAt === null).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  return {
    kind: "on_keyboard", boardName: config.boardName, putOn,
    reason: putOn === null
      ? `It is the config on your ${config.boardName}, so it can't be archived until another config is on it.`
      : `It is the config on your ${config.boardName}, so it can't be archived until another is on it. Put ${putOn.name} on it first.`,
  };
}
