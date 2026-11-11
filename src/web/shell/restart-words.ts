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
  | { kind: "failed"; message: string };

export const RESTART_LABEL = "Restart keyloom";
export const RESTARTING_WORDS = "Restarting keyloom… This page comes back by itself when keyloom is running again.";
export const TERMINAL_WORDS = "keyloom runs in a terminal. Stop it there with Ctrl-C, then run this to start it again:";

/** The state after Restart keyloom was answered. The server stops right after it answers, so an answer that never arrived is a restart too. */
export function afterRestart(error: { status?: number; code?: string | undefined; message: string } | null, command: string): RestartState {
  if (error === null) return { kind: "restarting" };
  if (error.status === 0) return { kind: "restarting" };
  if (error.code === "restart_unsupervised") return { kind: "terminal", command };
  return { kind: "failed", message: `keyloom didn't restart. ${error.message}` };
}
