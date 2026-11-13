import { ApiError } from "../api.ts";
import type { UnexpectedCode } from "../shell/unexpected.ts";

/**
 * The code UnexpectedWayOut takes for a failure no screen planned for (R8-03): a server exception, an answer this page can't read, or an
 * address keyloom doesn't know (the server's catch-all `not_found`, marked `generic`). A route's own `not_found` ("that keyboard is gone")
 * stays the screen's to map, so it gives undefined, as does every other code.
 */
export function unexpectedCodeOf(error: unknown): UnexpectedCode | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.code === "internal" || error.code === "unreadable") return error.code;
  return error.code === "not_found" && error.generic ? "not_found" : undefined;
}
