// What the "doesn't match its board" page does after the server refuses "Go back to the last revision that matched" (D-506). Pure, so
// the choice is tested without a browser.

import { type PageFailure, failsAgain, wayOutFor } from "./unexpected.ts";

/** `reload`: reading the layout again can make the same button work. `null`: it can't, so the button goes and the reason stays. */
export type GoBackRefusal = { text: string; next: "reload" | null };

export function goBackRefusal(code: string | undefined, message: string): GoBackRefusal {
  // The layout gained a revision since this page read it, so the undo named an old head. Reading it again gives the current one.
  if (code === "stale_base") return { text: "This layout changed since the page loaded, so keyloom didn't go back.", next: "reload" };
  // Anything else is about that revision itself, such as the rules refusing it: asking again fails the same way.
  return { text: message, next: null };
}

/**
 * The sentence after a failed look for an earlier revision that matched (R9-05). Look again is offered only when a second look can pass,
 * so a failure that fails the same way every time says why, and Restart keyloom beside it is the way on.
 */
export function lookupFailedWords(failure: PageFailure): string {
  if (failsAgain(failure)) return `keyloom couldn't look for an earlier revision that matched. ${failure.message} Or pick another layout, or archive this one; it keeps its history.`;
  return "keyloom couldn't look for an earlier revision that matched. Look again, pick another layout, or archive this one; it keeps its history.";
}

/**
 * The failure whose Restart keyloom the page shows (R9-05): a refused Go back or Archive first, then the look for a revision. One row of
 * buttons, so two failures never show two Restart keyloom buttons. Null when neither is a failure no screen planned for.
 */
export function mismatchUnexpected(refused: PageFailure | null, lookupFailed: PageFailure | null): PageFailure | null {
  return [refused, lookupFailed].find((failure): failure is PageFailure => failure !== null && wayOutFor(failure, true) !== null) ?? null;
}
