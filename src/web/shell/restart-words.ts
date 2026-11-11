// What the Restart keyloom action says (R5-15, D-521), from what the server answered. Pure, so the mapping is tested without a page.

export type RestartState =
  | { kind: "reading" }
  /** keyloom couldn't say how it was started; reading again can work once it answers. */
  | { kind: "unread"; message: string }
  /** The desktop app started this server and starts it again. */
  | { kind: "ready" }
  /** Started in a terminal: nobody starts it again, so the page gives the line to run there. */
  | { kind: "terminal"; command: string }
  | { kind: "restarting" }
  /** Not back on this page after RESTART_SLOW_AFTER_MS: a keyboard write may be finishing, keyloom is stuck, or it is back under a new link. */
  | { kind: "slow" }
  | { kind: "failed"; message: string };

export const RESTART_LABEL = "Restart keyloom";
export const RESTARTING_WORDS = "Restarting keyloom… If it is writing to a keyboard, it finishes that first. This page comes back by itself when keyloom is running again.";
/**
 * How long the page waits before it looks again. The server lets a keyboard write finish before it exits, with no limit, because a cut-off
 * write can leave the keyboard unusable (D-506). Quit in the menu bar gives it 30 s and then stops it.
 */
export const RESTART_SLOW_AFTER_MS = 45_000;
// The desktop window follows the new server by itself. A browser tab can't: the new server has a new session link.
export const SLOW_RESTART_WORDS = "keyloom isn't back on this page yet. It may still be writing to a keyboard, so don't unplug it. Choose Open keyloom in the menu bar to see it. If it doesn't open, choose Quit keyloom there, then open keyloom again.";
export const STILL_RUNNING_WORDS = "keyloom didn't restart, and it is still running.";
export const TERMINAL_WORDS = "keyloom runs in a terminal. Stop it there with Ctrl-C, then run this to start it again:";

/**
 * The state of a restart RESTART_SLOW_AFTER_MS after it was asked for, from whether this server still answers on the page's link. One that
 * answers never restarted (the request was lost on the way), so Restart keyloom is offered again; one that doesn't is still on its way.
 */
export function afterWaiting(stillAnswers: boolean): RestartState {
  return stillAnswers ? { kind: "failed", message: STILL_RUNNING_WORDS } : { kind: "slow" };
}

/**
 * The state after Restart keyloom was answered. The server stops right after it answers, so an answer that never arrived, or an OK whose
 * body was cut off (no `status`: only a body read throws without one), is a restart too. afterWaiting checks it later.
 */
export function afterRestart(error: { status?: number; code?: string | undefined; message: string } | null, command: string): RestartState {
  if (error === null) return { kind: "restarting" };
  if (error.status === undefined || error.status === 0 || (error.status >= 200 && error.status < 300)) return { kind: "restarting" };
  if (error.code === "restart_unsupervised") return { kind: "terminal", command };
  return { kind: "failed", message: `keyloom didn't restart. ${error.message}` };
}
