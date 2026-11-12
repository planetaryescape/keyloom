// The page's words and ways out for failures no screen planned for (R7-01, R7-09): a server exception, an address keyloom doesn't know,
// and an answer this page can't read. Each has a code, so a screen picks its buttons from the code and never parses the sentence. Pure.

/** A server exception, such as a locked database or a bug. The server's own detail goes to its log, never to the page. */
export const INTERNAL_WORDS = "keyloom hit a problem it didn't expect. The details are in keyloom's log.";
/**
 * keyloom doesn't have what the page asked for. Either it was deleted (another tab, the CLI), or this page is newer than the keyloom that
 * answers, so the route doesn't exist there. Asking again can't help with either; a restart loads the page that matches keyloom.
 */
export const NOT_FOUND_WORDS = "keyloom couldn't find what this page asked for. It may have been deleted, or this page is newer than the keyloom running now. Restarting keyloom opens the page that matches it.";
/** An answer the page can't read, or a refusal with no code: keyloom and this page are different versions. */
export const UNREADABLE_WORDS = "keyloom sent an answer this page can't read, which happens when keyloom and this page are different versions. Restarting keyloom opens the page that matches it.";

export type UnexpectedCode = "internal" | "not_found" | "unreadable";

/**
 * The code for a failed answer: the server's own when it sent one. Without one, a 404 is an address keyloom doesn't know, a 5xx is an
 * exception, and any other refusal is a request this keyloom doesn't understand, which is a version mismatch.
 */
export function failureCode(status: number, code: string | undefined): string {
  if (code !== undefined) return code;
  if (status === 404) return "not_found";
  if (status >= 500) return "internal";
  return "unreadable";
}

/** The sentence the page shows: its own for these codes, the server's for every other code, which each screen maps further. */
export function failureWords(code: string, serverMessage: string): string {
  if (code === "internal") return INTERNAL_WORDS;
  if (code === "not_found") return NOT_FOUND_WORDS;
  if (code === "unreadable") return UNREADABLE_WORDS;
  return serverMessage;
}

/**
 * The buttons for an unexpected failure, or null when the code is a screen's own. Try again only where the caller says repeating is
 * safe, and only for an exception, which can pass on a second try. Restart keyloom always: it clears a stuck state and loads the page that
 * matches keyloom. A missing thing or an unreadable answer fails the same way every time, so it never gets Try again.
 */
export function unexpectedWayOut(code: string | undefined, repeatable: boolean): { retry: boolean; restart: true } | null {
  if (code === "internal") return { retry: repeatable, restart: true };
  if (code === "not_found" || code === "unreadable") return { retry: false, restart: true };
  return null;
}
