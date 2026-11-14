// What the config card on a reply says and offers, as data. The card opens the config the agent made, or goes back to the one BK was
// on; it never claims more than the config list says (a config deleted since has no button).
import type { ApiConfig } from "../../api/configs.ts";
import { type PageFailure, wayOutFor } from "../shell/unexpected.ts";

export type ConfigCardData =
  | { state: "loading" }
  /** The config list couldn't be read; `failure` keeps its code, so the card offers Try again or Restart keyloom (R11-07). */
  | { state: "error"; failure: PageFailure }
  | { state: "gone" }
  /** `waiting` is null when the outside-chat count is unavailable or does not describe this card's chat-owned proposals. */
  | { state: "ready"; config: ApiConfig; waiting: number | null };

/** The config BK came from when the thread was carried here, which is where "Back" goes. */
export type CardOrigin = { id: string; name: string };

export type ConfigCardAction = { kind: "open" | "back" | "review" | "restore"; id: string; label: string };
export type ConfigCardView = {
  title: string;
  /** Board, source and open proposals, in the order they are read. */
  facts: string[];
  /** A sentence when there is nothing to open. */
  note: string | null;
  /** The main button, if any. */
  action: ConfigCardAction | null;
  /** A quieter second button: the way back, beside "Review" on the new config. */
  secondary: ConfigCardAction | null;
};

const count = (n: number | null) => (n === null ? [] : [countText(n)]);
const countText = (n: number) => (n === 0 ? "No proposals waiting" : n === 1 ? "1 proposal waiting" : `${n} proposals waiting`);

const NONE = { action: null, secondary: null };

export const CARD_READ_FAILED = "keyloom couldn't read this config right now.";

/** keyloom's sentence follows for a failure no screen planned for, because it explains the Restart keyloom beside it (D-551). */
const errorNote = (failure: PageFailure): string => (wayOutFor(failure, true) === null ? CARD_READ_FAILED : `${CARD_READ_FAILED} ${failure.message}`);

export function configCardView(data: ConfigCardData, currentId: string, origin: CardOrigin | null, configId: string): ConfigCardView {
  const unnamed = "A config keyloom made";
  if (data.state === "loading") return { title: unnamed, facts: [], note: null, ...NONE };
  if (data.state === "error") return { title: unnamed, facts: [], note: errorNote(data.failure), ...NONE };
  if (data.state === "gone") return { title: unnamed, facts: [], note: "This config has since been deleted.", ...NONE };
  const { config, waiting } = data;
  const facts = [config.boardName];
  if (config.copiedFrom !== null) facts.push(`Copied from ${config.copiedFrom.layoutName ?? "a config that has been deleted"}`);
  if (config.archivedAt !== null) return { title: config.name, facts, note: "This config is archived.", action: { kind: "restore", id: config.id, label: "Restore and open" }, secondary: null };
  const counted = [...facts, ...count(waiting)];
  if (configId !== currentId) return { title: config.name, facts: counted, note: null, action: { kind: "open", id: config.id, label: "Open" }, secondary: null };
  // On the new config: review what waits on it, and keep the way back to the config BK asked from when this thread knows it.
  const back = origin !== null && origin.id !== currentId ? { kind: "back" as const, id: origin.id, label: `Back to ${origin.name}` } : null;
  // The count is the button's own words ("Review 2 proposals"), so the facts don't say it twice.
  if (waiting !== null && waiting > 0) {
    return { title: config.name, facts, note: null, action: { kind: "review", id: config.id, label: waiting === 1 ? "Review proposal" : `Review ${waiting} proposals` }, secondary: back };
  }
  return { title: config.name, facts: counted, note: null, action: back, secondary: null };
}
