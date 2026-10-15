// Legends are never truncated: a long legend gets a smaller font instead. Browsers can't
// measure text before layout in a way tests can see, so this estimates width from per-glyph
// advances. Real widths are checked in the browser (see docs of the viewer's tests).
//
// All sizes are in key units (1u = one 1x1 keycap edge), so they hold at any zoom.

// Space a cap takes away from its box: the gap to its neighbours plus padding on both sides.
export const CAP_INSET = 0.22;

export const TAP_SIZE = { max: 0.3, min: 0.17 };
export const HOLD_SIZE = { max: 0.19, min: 0.15 };

// Advance widths in em for a bold system sans, rounded up so the estimate errs wide.
const NARROW = new Set("iljI.,;:!'|`");
const WIDE = new Set("MWmw");
const SYMBOL = /[←-⇿⌀-⏿⌘⌥⌃⇧⌦⌫]/u;

function glyphEm(char: string): number {
  if (NARROW.has(char)) return 0.34;
  if (WIDE.has(char)) return 0.95;
  if (SYMBOL.test(char)) return 1;
  if (char >= "A" && char <= "Z") return 0.74;
  if (char >= "0" && char <= "9") return 0.64;
  return 0.6;
}

/** Estimated width of a legend in em. */
export function textEm(text: string): number {
  let total = 0;
  for (const char of text) total += glyphEm(char);
  return total;
}

export type LegendFit = {
  /** Font size in key units. */
  size: number;
  /** False when even the smallest size would overflow, so the text wraps instead of clipping. */
  fits: boolean;
};

// Symbols such as ⌫ and ⌥ are drawn small in most fonts, so a legend made only of them is
// drawn larger than text of the same nominal size.
const SYMBOL_BOOST = 1.25;
const symbolsOnly = (text: string): boolean => text !== "" && [...text].every((char) => SYMBOL.test(char));

export function fitLegend(text: string, keyWidth: number, range: { max: number; min: number }): LegendFit {
  const available = keyWidth - CAP_INSET;
  const em = textEm(text);
  const max = symbolsOnly(text) ? range.max * SYMBOL_BOOST : range.max;
  if (em === 0) return { size: max, fits: true };
  const wanted = available / em;
  if (wanted >= max) return { size: max, fits: true };
  if (wanted >= range.min) return { size: wanted, fits: true };
  return { size: range.min, fits: false };
}
