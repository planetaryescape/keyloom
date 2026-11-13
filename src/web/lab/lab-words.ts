// What the typing lab offers beside a problem, from the server's code (R1-19). A keyloom build that can't stream yet is fixed by putting
// keyloom's current build on it: Sync now when keyloom syncs this board, Build and flash otherwise or when the sync fails. Firmware keyloom
// didn't build is Build and flash's alone, because a sync never replaces it. macOS's refusal opens Input Monitoring (R3-09).
import { type PageFailure, failsAgain, pageFailure, wayOutFor } from "../shell/unexpected.ts";

export type LabFix = { id: "sync_now" | "open_release" | "reload" | "open_input_monitoring" | "retry" | "restart" | "read_again" | "stop_recording"; label: string };

/**
 * The code the lab keeps for a failed request (R10-07). keyloom's catch-all `not_found` names no session, so it is kept as the page's own
 * `unexpected_not_found`, never as a session deleted in another tab, and gets Restart keyloom: asking again fails the same way.
 */
export function labProblemCode(error: unknown): string | null {
  const failure = pageFailure(error, "");
  if (failure.code === "not_found" && failure.generic === true) return "unexpected_not_found";
  return failure.code ?? null;
}

/**
 * The code for a Cancel that failed (R6-20, R10-07): `cancel_failed`, whose button stops the recording again, or the page's own
 * `cancel_stuck` when a second cancel would fail the same way, which gets Restart keyloom: restarting closes the keyboard's stream.
 */
export function labCancelCode(error: unknown): "cancel_failed" | "cancel_stuck" {
  return failsAgain(pageFailure(error, "")) ? "cancel_stuck" : "cancel_failed";
}

export function labFixes(code: string | null, loadFailed: boolean): LabFix[] {
  // A list that couldn't be read because keyloom can't read its answers, or doesn't know the route, fails the same way: restart (R7-01).
  // The page's own `unexpected_not_found` is that catch-all 404 too, wherever it came from (#313 review).
  if (loadFailed && (code === "unreadable" || code === "not_found" || code === "unexpected_not_found")) return [{ id: "restart", label: "Restart keyloom" }];
  if (loadFailed) return [{ id: "reload", label: "Try again" }];
  // No keyboard to listen to, or the computer refused it: plug it in or allow it, then the same passage starts again (R7-07).
  if (code === "not_connected" || code === "permission_denied") return [{ id: "retry", label: "Try again" }];
  // The recording ended before Stop reached it, in another tab or by a Cancel, so the passage is lost and is typed again (R7-07).
  if (code === "not_recording") return [{ id: "retry", label: "Start listening again" }];
  // A session another tab deleted: reading the list again drops it.
  if (code === "not_found") return [{ id: "reload", label: "Read the sessions again" }];
  // An exception may have left the keyboard's stream open; restarting keyloom closes it. Start listening stays on the card (R7-01).
  if (code === "internal" || code === "unreadable" || code === "unexpected_not_found" || code === "cancel_stuck") return [{ id: "restart", label: "Restart keyloom" }];
  if (code === "needs_sync") return [{ id: "sync_now", label: "Sync now" }, { id: "open_release", label: "Build and flash…" }];
  if (code === "foreign_firmware") return [{ id: "open_release", label: "Build and flash…" }];
  if (code === "permission_input_monitoring") return [{ id: "open_input_monitoring", label: "Open Input Monitoring settings" }, { id: "retry", label: "Try again" }];
  // A keyboard connection that stopped answering is replaced on the next try (R4-03).
  if (code === "busy" || code === "connection_lost") return [{ id: "retry", label: "Try again" }];
  // A stuck connection outlives every try in this keyloom, so restarting keyloom is the way on (R5-15).
  if (code === "restart_required") return [{ id: "restart", label: "Restart keyloom" }];
  // A recording still running, here or in another tab, or one a Cancel failed to stop, is stopped from here (R6-20). Starting again
  // before it stops is refused the same way, so there is no Try again. It is the cancel route, so what it heard is discarded: the text
  // typed for it lives in the tab that started it, and a read-out without that text would be wrong (D-528). The label says so.
  if (code === "recording_running" || code === "cancel_failed") return [{ id: "stop_recording", label: "Stop and discard that recording" }];
  // A replay that failed for any reason but Docker may pass on a second read: the recording is saved (R6-02). Docker gets its own callout.
  if (code === "replay_failed") return [{ id: "read_again", label: "Read it again" }];
  return [];
}

/** The problem line. Codes with a button get the page's own words; the server's name System Settings paths and CLI steps. */
export function labProblemText(code: string | null, message: string, boardName = "keyboard"): string {
  if (code === "not_connected") return `keyloom can't find your ${boardName}. Plug it into this computer with a USB cable, then try again.`;
  // The server's sentence is the platform's own step, such as the Linux group to join; it names no command.
  if (code === "permission_denied") return `Your computer didn't let keyloom read your ${boardName}. ${message}`;
  if (code === "not_recording") return "keyloom had stopped listening before you pressed Stop, perhaps from another tab, so the passage you typed was lost. Start listening again to record it.";
  if (code === "not_found") return "keyloom can't find that session any more. It may have been deleted in another tab.";
  if (code === "permission_input_monitoring") return "macOS didn't let keyloom read your keyboard. Allow keyloom in Input Monitoring, then try again.";
  if (code === "foreign_firmware") return "Your keyboard runs firmware keyloom didn't build, so it can't stream its keys. Build and flash puts keyloom's build on it.";
  if (code === "connection_lost") return "keyloom's connection to the keyboard stopped answering. Try again, and keyloom opens a new one.";
  if (code === "restart_required") return "keyloom's connection to the keyboard is stuck, and only restarting keyloom clears it. Then start listening again.";
  if (code === "recording_running") return "A recording is already running in keyloom, perhaps in another tab. Stopping it here discards what it heard, and nothing from it is saved. Then start listening again.";
  if (code === "cancel_failed") return `keyloom couldn't stop listening, so it may still be recording your keyboard. ${message} Stopping it discards what it heard.`;
  if (code === "cancel_stuck") return `keyloom couldn't stop listening, so it may still be recording your keyboard. ${message}`;
  // The server's sentence for this code is keyloom's own and names no path or key (R6-02), so the page says it in full.
  if (code === "replay_failed") return "keyloom couldn't play your recording back through the board's firmware. The details are in keyloom's log. Your recording is saved.";
  return message;
}

/** What the lab says when Docker stopped a read-out (R6-02), beside the same Docker callout a build gets. */
export const LAB_NEEDS_DOCKER = {
  need: "keyloom reads a recording by playing it through your board's firmware in Docker, and Docker isn't ready on this computer. Your recording is saved.",
  again: "Read it again",
  readyNext: "Read it again to see how you typed.",
} as const;

/** True when the lab's problem is Docker, so the page shows the Docker callout instead of the problem line. */
export const labNeedsDocker = (code: string | null): boolean => code === "docker_unavailable";

/**
 * Why Apply on a lab fix failed (R3-02), and the way on. A layout changed since the recording no longer takes the fix as it was tried, so
 * the way on is to type again on the layout as it is now; any other failure may pass on a second try.
 */
export function labApplyFailure(error: { code?: string | undefined; message: string; generic?: boolean | undefined }): { text: string; next: "again" | "retry" | "restart"; failure?: PageFailure } {
  if (error.code === "stale_base") return { text: "The layout changed since this recording, so this fix no longer applies as it was tried. Type again to try fixes on the layout as it is now.", next: "again" };
  if (error.code === "validation_failed") return { text: "The layout's checks refused this fix as the layout is now. Type again to try fixes on the layout as it is now.", next: "again" };
  // The apply route answers `not_open` for a fix that is no longer proposed, and `usage` for its other refusals; a second try is refused
  // the same way.
  if (error.code === "not_open" || error.code === "usage") return { text: "This fix can't be applied any more. Type again to try fixes on the layout as it is now.", next: "again" };
  // A failure no screen planned for keeps its code (R9-05, D-540): an exception may pass on a second try and names keyloom's log; an answer
  // this page can't read, or keyloom's catch-all 404, fails the same way, so the way on is Restart keyloom, never Try again.
  const failure: PageFailure = { message: error.message, code: error.code, ...(error.generic === true ? { generic: true } : {}) };
  const way = wayOutFor(failure, true);
  if (way !== null) return { text: `keyloom couldn't apply this fix. ${error.message}`, next: way.retry ? "retry" : "restart", failure };
  return { text: `keyloom couldn't apply this fix. ${error.message}`, next: "retry" };
}

/**
 * Why a fix from a past recording can't be applied, or null while it can. A read-out keeps every fix it tried, but only a proposed one can
 * be applied: the server refuses the rest every time, so the card says why and offers Type again instead of Apply.
 */
export function labFixClosed(status: "proposed" | "applied" | "rejected" | "superseded"): string | null {
  switch (status) {
    case "proposed": return null;
    case "applied": return "This fix was applied already. Type again to see how your typing does now.";
    case "superseded": return "A later change replaced this fix. Type again to try fixes on the layout as it is now.";
    case "rejected": return "This fix was turned down. Type again to try fixes on the layout as it is now.";
  }
}

/**
 * Why a fix has no proposal to apply (R10-12, #313 review). Only a refusal stores `problem`, so a string means keyloom's checks refused the
 * fix on the layout as it is now, and the check's own reason follows. No `problem` means keyloom never tried to propose it, as after
 * `keyloom lab analyse --no-propose`: no check ran, so the words never say one refused it. Pure.
 */
export function noProposalWords(problem: string | null | undefined): string {
  if (typeof problem !== "string") return NOT_PROPOSED;
  const lead = "keyloom's checks refused this fix on your layout as it is now, so it can't be applied.";
  const reason = problem.trim();
  if (reason === "") return lead;
  return `${lead} ${reason.charAt(0).toUpperCase()}${reason.slice(1)}${/[.!?]$/.test(reason) ? "" : "."}`;
}

/** A fix keyloom read but never proposed, so Read it again with fixes, which proposes them, is its way on. */
export const NOT_PROPOSED = "keyloom didn't propose this fix when it read this recording, so there is nothing to apply yet.";
export const READ_WITH_FIXES = "Read it again with fixes";

/** True for a fix keyloom never proposed (no stored refusal), which reading the recording again with fixes proposes. */
export const notProposed = (s: { proposal: unknown; problem?: string | null | undefined }): boolean => s.proposal === null && typeof s.problem !== "string";
