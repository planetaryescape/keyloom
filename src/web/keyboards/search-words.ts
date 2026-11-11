// What the QMK and ZMK search says under its box (R4-12): a search that found nothing says so and offers the contribution guide, rather
// than leaving the list blank.

/** keyloom's guide for adding a keyboard it doesn't know yet. */
export const CONTRIBUTION_GUIDE = "https://github.com/planetaryescape/keyloom/blob/main/CONTRIBUTING.md";

export type SearchNote = "too_short" | "searching" | "none" | null;

/**
 * `foundFor` is the text the current results answer, `count` how many there are, and `failed` whether the last search failed (its own
 * alert says why). Null when the results speak for themselves.
 */
export function searchNote(query: string, foundFor: string | null, count: number, failed: boolean): SearchNote {
  const text = query.trim();
  if (text.length < 2) return "too_short";
  if (failed) return null;
  if (foundFor !== text) return "searching";
  return count === 0 ? "none" : null;
}
