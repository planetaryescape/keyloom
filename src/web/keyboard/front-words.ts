// What a cap prints on its front skirt for a hold (D-267). A lone modifier is spelled out the way Apple's keycaps print it ("⌥ option"),
// and the named sets get their words, when that fits the cap at the legend's size; otherwise the short form stays. Which side's
// modifier it is (r⌥) is in the key's name and its card, not on the cap.
import { CAP_INSET, HOLD_SIZE, LEGEND_FLOOR_PX, textEm } from "./fit.ts";

// Longest first: the first that fits the cap is printed.
const WORDS: Readonly<Record<string, readonly string[]>> = {
  "⌃": ["⌃ control", "⌃ ctrl"],
  "⌥": ["⌥ option", "⌥ opt"],
  "⇧": ["⇧ shift"],
  "⌘": ["⌘ command", "⌘ cmd"],
  Hyp: ["✦ hyper", "✦ hyp"],
  Meh: ["◆ meh"],
};

// Front legends are set condensed (font-stretch 78%), which the regular-face estimate in fit.ts doesn't know. 0.86 keeps a margin:
// at 0.78 "⌘ command" passed the estimate on a 49px cap and was clipped.
const CONDENSED = 0.86;

/** `unit` is px per key unit: a legend never goes under the floor, so on small caps it is larger in key units than HOLD_SIZE.min. */
export function frontWords(hold: string, keyWidth: number, unit: number, floorPx = LEGEND_FLOOR_PX): string {
  const side = hold.startsWith("r") && hold.length > 1 ? hold.slice(1) : hold;
  const size = Math.max(HOLD_SIZE.min, floorPx / unit);
  const room = keyWidth - CAP_INSET;
  return WORDS[side]?.find((words) => textEm(words) * CONDENSED * size <= room) ?? hold;
}
