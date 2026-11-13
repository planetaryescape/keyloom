// What a failed read of a config's open proposals says and offers (R11-05), from the failure's code, never its sentence. Pure.
import { type PageFailure, failsAgain, wayOutFor } from "../shell/unexpected.ts";

/** The route's own `not_found`: the config was deleted, in another window or from the CLI. */
export const CONFIG_GONE = "keyloom no longer has this config. It may have been deleted in another window.";

/**
 * `gone`: the config itself is gone, so the way on is the layouts keyloom still has, never a restart (D-534). `restart`: the read fails
 * the same way every time (keyloom's catch-all, an answer this page can't read), so Restart keyloom is the only button (D-551). `retry`:
 * a second read can pass, such as after a lost connection or a server exception; an exception adds Restart keyloom.
 */
export type ProposalsReadWay = "gone" | "restart" | "retry";

export function proposalsReadWay(failure: PageFailure): ProposalsReadWay {
  if (failure.code === "not_found" && failure.generic !== true) return "gone";
  return failsAgain(failure) ? "restart" : "retry";
}

/**
 * The sentence under a failed read: the screen's own `lead`, then keyloom's sentence for a failure no screen planned for, because that
 * sentence explains the Restart keyloom beside it (D-551). A config that is gone says only that.
 */
export function proposalsReadWords(failure: PageFailure, lead: string): string {
  if (proposalsReadWay(failure) === "gone") return CONFIG_GONE;
  return wayOutFor(failure, true) === null ? lead : `${lead} ${failure.message}`;
}
