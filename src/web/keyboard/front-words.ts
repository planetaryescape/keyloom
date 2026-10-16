// What a cap prints on its front skirt for a hold (D-267). A lone modifier is spelled out the way Apple's keycaps print it ("⌥ option"),
// and the named sets get their words; on a cap too small for the symbol and the word, the word alone. Which side's modifier it is
// is in the key's name and its card, not on the cap.
import { CAP_INSET, CONDENSED_EM, HOLD_SIZE, LEGEND_FLOOR_PX, textEm } from "./fit.ts";

// With the symbol, then the word alone. Words are never abbreviated (D-270).
const WORDS: Readonly<Record<string, readonly string[]>> = {
  "⌃": ["⌃ control", "control"],
  "⌥": ["⌥ option", "option"],
  "⇧": ["⇧ shift", "shift"],
  "⌘": ["⌘ command", "command"],
  "✦": ["✦ hyper", "hyper"],
  "◆": ["◆ meh", "meh"],
};

/** The widest front print with a symbol: if it fits a 1u cap, every cap on the board prints symbol and word; if not, none does. */
export const WIDEST_WITH_SYMBOL = "⌘ command";

/**
 * Whether front prints carry their symbol on this board (P1 review): one answer for every cap, so a row never mixes "⌥ option" with
 * "command". `measured` is the widest print's real width in px, when the browser could measure it; otherwise fit.ts's estimate decides.
 */
export function frontSymbols(unit: number, measured: number | null, gapUnits: number, floorPx = LEGEND_FLOOR_PX): boolean {
  const room = (1 - gapUnits) * unit;
  if (measured !== null) return measured <= room;
  const size = Math.max(HOLD_SIZE.min, floorPx / unit);
  return textEm(WIDEST_WITH_SYMBOL) * CONDENSED_EM * size <= 1 - CAP_INSET;
}

/** The front print for a hold: a lone modifier spelled out, with its symbol when the board's caps carry symbols. */
export function frontWords(hold: string, withSymbol: boolean): string {
  const words = WORDS[hold];
  if (words === undefined) return hold;
  return (withSymbol ? words[0] : words[1]) ?? hold;
}
