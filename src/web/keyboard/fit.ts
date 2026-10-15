// Legends are never truncated and never drawn below the floor (18#legends): a long legend is
// shortened where it is made (layout/legend.ts), and one that still doesn't fit wraps at the
// floor instead of shrinking past it. Browsers can't
// measure text before layout in a way tests can see, so this estimates width from per-glyph
// advances. Real widths are checked in the browser (see docs of the viewer's tests).
//
// All sizes are in key units (1u = one 1x1 keycap edge), so they hold at any zoom.

// Space a cap takes away from its box: the gap to its neighbours plus padding on both sides.
export const CAP_INSET = 0.22;

export const TAP_SIZE = { max: 0.3, min: 0.17 };
export const HOLD_SIZE = { max: 0.19, min: 0.15 };

/** The smallest legend, in px, on a laptop. Phones may go to 10. */
export const LEGEND_FLOOR_PX = 11;

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

// A name such as layer_td or C_PLAY_PAUSE can break after its underscores, plusses and brackets, so what has
// to fit on one line is its longest piece. The cap breaks it there (keyboard/Cap.tsx), never mid-word.
const SEAM = /(?<=[_+(])/;

/** Estimated width in em of the longest piece of a legend that can wrap at its own seams. */
export function widestPieceEm(text: string): number {
  return Math.max(0, ...text.split(SEAM).map(textEm));
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

/**
 * `px` turns the floor into key units for the unit size the board is drawn at, so no legend
 * lands below LEGEND_FLOOR_PX. Without it only the range's own minimum applies.
 */
export function fitLegend(text: string, keyWidth: number, range: { max: number; min: number }, px?: { unit: number; floor?: number }): LegendFit {
  const floor = px === undefined ? 0 : (px.floor ?? LEGEND_FLOOR_PX) / px.unit;
  const min = Math.max(range.min, floor);
  const available = keyWidth - CAP_INSET;
  const em = widestPieceEm(text);
  const max = Math.max(min, symbolsOnly(text) ? range.max * SYMBOL_BOOST : range.max);
  if (em === 0) return { size: max, fits: true };
  const wanted = available / em;
  if (wanted >= max) return { size: max, fits: true };
  if (wanted >= min) return { size: wanted, fits: true };
  return { size: min, fits: false };
}
