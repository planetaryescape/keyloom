// What the config card on a reply says and offers, as data. The card opens the config the agent made, or goes back to the one BK was
// on; it never claims more than the config list says (a config deleted since has no button).
import type { ApiConfig } from "../../api/configs.ts";

export type ConfigCardData =
  | { state: "loading" }
  | { state: "error" }
  | { state: "gone" }
  | { state: "ready"; config: ApiConfig; waiting: number };

/** The config BK came from when the thread was carried here, which is where "Back" goes. */
export type CardOrigin = { id: string; name: string };

export type ConfigCardAction = { kind: "open" | "back"; id: string; label: string };
export type ConfigCardView = {
  title: string;
  /** Board, source and open proposals, in the order they are read. */
  facts: string[];
  /** A sentence when there is nothing to open. */
  note: string | null;
  action: ConfigCardAction | null;
};

const count = (n: number) => (n === 0 ? "No proposals waiting" : n === 1 ? "1 proposal waiting" : `${n} proposals waiting`);

export function configCardView(data: ConfigCardData, currentId: string, origin: CardOrigin | null, configId: string): ConfigCardView {
  if (data.state === "loading") return { title: "A config keyloom made", facts: [], note: null, action: null };
  if (data.state === "error") return { title: "A config keyloom made", facts: [], note: "Couldn't load this config. Open it from the config menu.", action: null };
  if (data.state === "gone") return { title: "A config keyloom made", facts: [], note: "This config has since been deleted.", action: null };
  const { config, waiting } = data;
  const facts = [config.boardName];
  if (config.copiedFrom !== null) facts.push(`Copied from ${config.copiedFrom.layoutName ?? "a config that has been deleted"}`);
  if (config.archivedAt === null) facts.push(count(waiting));
  if (config.archivedAt !== null) return { title: config.name, facts, note: "Archived. Restore it from the config menu to open it.", action: null };
  if (configId !== currentId) return { title: config.name, facts, note: null, action: { kind: "open", id: config.id, label: "Open" } };
  // On the new config: the way back is the config BK asked from, when this thread knows it and it is still another config.
  const back = origin !== null && origin.id !== currentId ? { kind: "back" as const, id: origin.id, label: `Back to ${origin.name}` } : null;
  return { title: config.name, facts, note: null, action: back };
}
