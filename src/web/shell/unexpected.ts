// The page's words and ways out for failures no screen planned for (R7-01, R7-09): a server exception, an address keyloom doesn't know,
// and an answer this page can't read. Each has a code, so a screen picks its buttons from the code and never parses the sentence. Pure.

/** A server exception, such as a locked database or a bug. The server's own detail goes to its log, never to the page. */
export const INTERNAL_WORDS = "keyloom hit a problem it didn't expect. The details are in keyloom's log.";
/**
 * keyloom doesn't have what the page asked for. Either it was deleted (another tab, the CLI), or this page is newer than the keyloom that
 * answers, so the route doesn't exist there. Asking again can't help with either; a restart loads the page that matches keyloom.
 */
export const NOT_FOUND_WORDS = "keyloom couldn't find what this page asked for. It may have been deleted, or this page is newer than the keyloom running now. Restarting keyloom opens the page that matches it.";
/** A body over the server's cap, which Bun refuses with a bare 413 before any route can say so in its own words. */
export const TOO_LARGE_WORDS = "That is too large for keyloom to take.";
/** An answer the page can't read, or a refusal with no code: keyloom and this page are different versions. */
export const UNREADABLE_WORDS = "keyloom sent an answer this page can't read, which happens when keyloom and this page are different versions. Restarting keyloom opens the page that matches it.";

export type UnexpectedCode = "internal" | "not_found" | "unreadable";

/**
 * A failure as a screen keeps it (R8-03): the sentence to show, and what picks its buttons. Keep this, not `error.message` alone: a screen
 * that drops the code can only offer a Try again, which fails the same way for every unexpected code but `internal`.
 */
export interface PageFailure {
  message: string;
  code?: string | undefined;
  /** keyloom's catch-all `not_found`, or an answer with no code: the address doesn't exist there, so nothing named was deleted. */
  generic?: boolean | undefined;
}

/** A caught error as a screen keeps it. It reads ApiError's fields by name, so this file stays free of the fetch code and pure. */
export function pageFailure(error: unknown, fallback: string): PageFailure {
  if (!(error instanceof Error)) return { message: fallback };
  // SAFETY: both fields are read as unknown and checked below, so an Error without them yields neither.
  const { code, generic } = error as { code?: unknown; generic?: unknown };
  return { message: error.message === "" ? fallback : error.message, ...(typeof code === "string" ? { code } : {}), ...(generic === true ? { generic: true } : {}) };
}

/** A kept failure as an Error again, for code that must reject: `pageFailure` reads its code back, so it isn't lost on the way (R8-03). */
export function failureError(failure: PageFailure): Error {
  return Object.assign(new Error(failure.message), failure.code === undefined ? {} : { code: failure.code }, failure.generic === true ? { generic: true } : {});
}

/**
 * The code for a failed answer: the server's own when it sent one. Without one, a 404 is an address keyloom doesn't know, a 413 is a body
 * over the server's cap (Bun answers it before any route runs), a 5xx is an exception, and any other refusal is a request this keyloom
 * doesn't understand, which is a version mismatch.
 */
export function failureCode(status: number, code: string | undefined): string {
  if (code !== undefined) return code;
  if (status === 404) return "not_found";
  if (status === 413) return "too_large";
  if (status >= 500) return "internal";
  return "unreadable";
}

/**
 * The sentence the page shows. An exception and an unreadable answer always get the page's own words. Every other code keeps the server's
 * sentence, which each screen maps further, such as a route's "This build has no firmware file. Build it again.". `serverMessage` is null
 * when the server said nothing a person can read: no code at all, or its catch-all `not_found` (`generic`). Then the page says it.
 */
export function failureWords(code: string, serverMessage: string | null): string {
  if (code === "internal") return INTERNAL_WORDS;
  if (code === "unreadable") return UNREADABLE_WORDS;
  if (serverMessage !== null) return serverMessage;
  if (code === "not_found") return NOT_FOUND_WORDS;
  if (code === "too_large") return TOO_LARGE_WORDS;
  return UNREADABLE_WORDS;
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

/**
 * The buttons for a failure a screen kept (R8-03), or null when they are the screen's own. A route's own `not_found` names something that
 * was deleted, so the screen's own words and buttons say what to do (D-534); only keyloom's catch-all, an address it doesn't have, is the
 * version mismatch a restart clears.
 */
export function wayOutFor(failure: PageFailure, repeatable: boolean): { retry: boolean; restart: true } | null {
  if (failure.code === "not_found" && failure.generic !== true) return null;
  return unexpectedWayOut(failure.code, repeatable);
}
