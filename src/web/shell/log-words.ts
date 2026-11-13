// What the page says after "The details are in keyloom's log." (R8-09, D-541), so the sentence comes with a way to read the log. Pure.
import type { ServerLog } from "../../api/server-log.ts";

export const SHOW_LOG_LABEL = "Show keyloom's log";
export const TERMINAL_LOG_WORDS = "keyloom's log is the terminal it runs in.";
export const LOG_FILE_WORDS = "keyloom's log is this file:";

/** What sits beside the failure: a Show keyloom's log button, the file's path to copy, or where else the log is. */
export type LogWay = { show: boolean; path: string | null; words: string | null };

/**
 * The way to the log. In the desktop app, Show keyloom's log opens it in Console, as the app's own problem window does. In a browser the
 * page also gives the file's path to copy, because the person may want it somewhere else. Null when keyloom couldn't say where its log
 * is (an older keyloom): the page then adds nothing, and Restart keyloom beside it says what to do.
 */
export function logWay(log: ServerLog | null, desktop: boolean): LogWay | null {
  if (log === null) return null;
  if (log.kind === "terminal") return { show: false, path: null, words: TERMINAL_LOG_WORDS };
  if (log.canShow && desktop) return { show: true, path: null, words: null };
  return { show: log.canShow, path: log.path, words: LOG_FILE_WORDS };
}
