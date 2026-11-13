// What the config switcher says when keyloom couldn't read this keyboard's configs (R11-07). Pure.
import { type PageFailure, wayOutFor } from "../shell/unexpected.ts";

export const CONFIG_LIST_FAILED = "keyloom couldn't read this keyboard's configs.";

/** The switcher's sentence: the page's own, then keyloom's for a failure no screen planned for, which explains Restart keyloom (D-551). */
export function configListWords(failure: PageFailure): string {
  return wayOutFor(failure, true) === null ? CONFIG_LIST_FAILED : `${CONFIG_LIST_FAILED} ${failure.message}`;
}

/**
 * Why Archive is off while the list is unknown, or null. The list says which config is on the keyboard, and the server refuses to archive
 * that one (R3-06), so an unread list can't tell whether Archive would work.
 */
export function archiveWaits(failure: PageFailure | null, boardName: string): string | null {
  return failure === null ? null : `keyloom can't tell whether this config is on your ${boardName} until it reads your configs again.`;
}
