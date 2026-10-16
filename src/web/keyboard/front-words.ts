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

/** The widest front print with a symbol, and the widest word alone. */
export const WIDEST_WITH_SYMBOL = "⌘ command";
export const WIDEST_WORD = "command";

/** How a board's caps print a held modifier on the front: symbol and word, the word, or the symbol alone. One mode for every cap. */
export type FrontMode = "both" | "word" | "mark";

/**
 * The mode for a board (P1 review): the fullest print whose widest case fits a 1u cap's front, measured in the loaded font. On a small
 * cap (a short window with a mouse) even the word may not fit; then every cap prints the symbol alone rather than a cut-off word.
 * `measured` is null when the browser couldn't measure; then fit.ts's estimate decides, erring toward shorter prints.
 */
/** The front print keeps this far from the cap body's edges, in key units; the per-key check in Cap.tsx uses the same room. */
export const FRONT_INSET = 0.1;

export function frontMode(unit: number, measured: { both: number; word: number } | null, gapUnits: number, floorPx = LEGEND_FLOOR_PX): FrontMode {
  // The same room the per-key check allows: with a looser limit here, a print that fit the board's choice was cut on its own cap
  // ("⌘ com" on a 56 px Glove80 cap, 0.56 px short).
  const room = (1 - Math.max(gapUnits, FRONT_INSET)) * unit;
  if (measured !== null) return measured.both <= room ? "both" : measured.word <= room ? "word" : "mark";
  const size = Math.max(HOLD_SIZE.min, floorPx / unit);
  const fits = (text: string) => textEm(text) * CONDENSED_EM * size <= 1 - CAP_INSET;
  return fits(WIDEST_WITH_SYMBOL) ? "both" : fits(WIDEST_WORD) ? "word" : "mark";
}

/** The front print for a hold: a lone modifier as the board's mode says. Anything else is printed as it is. */
export function frontWords(hold: string, mode: FrontMode): string {
  const words = WORDS[hold];
  if (words === undefined) return hold;
  return mode === "both" ? (words[0] ?? hold) : mode === "word" ? (words[1] ?? hold) : hold;
}
