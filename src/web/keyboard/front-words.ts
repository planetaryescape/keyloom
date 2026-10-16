// What a cap prints on its front skirt for a hold (D-267). A lone modifier is spelled out the way Apple's keycaps print it ("⌥ option"),
// and the named sets get their words; on a cap too small for the symbol and the word, the word alone. Which side's modifier it is
// is in the key's name and its card, not on the cap.
import { CAP_INSET, CONDENSED_EM, HOLD_SIZE, LEGEND_FLOOR_PX, textEm } from "./fit.ts";

// Longest first: the first that fits the cap is printed. Words are never abbreviated; on a small cap the symbol goes first (D-270).
const WORDS: Readonly<Record<string, readonly string[]>> = {
  "⌃": ["⌃ control", "control"],
  "⌥": ["⌥ option", "option"],
  "⇧": ["⇧ shift", "shift"],
  "⌘": ["⌘ command", "command"],
  "✦": ["✦ hyper", "hyper"],
  "◆": ["◆ meh", "meh"],
};

/** `unit` is px per key unit: a legend never goes under the floor, so on small caps it is larger in key units than HOLD_SIZE.min. */
export function frontWords(hold: string, keyWidth: number, unit: number, floorPx = LEGEND_FLOOR_PX): string {
  const size = Math.max(HOLD_SIZE.min, floorPx / unit);
  const room = keyWidth - CAP_INSET;
  const words = WORDS[hold];
  if (words === undefined) return hold;
  return words.find((candidate) => textEm(candidate) * CONDENSED_EM * size <= room) ?? words[words.length - 1] ?? hold;
}
