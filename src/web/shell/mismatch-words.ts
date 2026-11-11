// What the "doesn't match its board" page does after the server refuses "Go back to the last revision that matched" (D-503). Pure, so
// the choice is tested without a browser.

/** `reload`: reading the layout again can make the same button work. `null`: it can't, so the button goes and the reason stays. */
export type GoBackRefusal = { text: string; next: "reload" | null };

export function goBackRefusal(code: string | undefined, message: string): GoBackRefusal {
  // The layout gained a revision since this page read it, so the undo named an old head. Reading it again gives the current one.
  if (code === "stale_base") return { text: "This layout changed since the page loaded, so keyloom didn't go back.", next: "reload" };
  // Anything else is about that revision itself, such as the rules refusing it: asking again fails the same way.
  return { text: message, next: null };
}
