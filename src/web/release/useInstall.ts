// One install from a button (D-488, D-489): starts it, follows its output once a second until it finishes, and calls
// `onDone` when it ends so the dialog re-reads what is now on the computer. It can be cancelled (R2-08).
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { InstallState, InstallableTool } from "../../api/tool-install.ts";
import { cancelInstall, fetchInstall, startInstall } from "./install-api.ts";
import { type PageFailure, failsAgain, pageFailure, wayOutFor } from "../shell/unexpected.ts";

const POLL_MS = 1000;
/** Reads of a running install that may fail in a row before the page says it lost track of it (R10-07): one miss is a blip. */
export const LOST_AFTER = 3;

/**
 * What the page says once reads of a running install keep failing (R10-07), and whether to keep reading. A read that fails the same way
 * every time (an answer the page can't read, keyloom's catch-all 404) stops the reads, and Restart keyloom beside it is the way on. Any
 * other failure, such as a lost connection, keeps reading by itself, and Check again reads at once.
 */
export function installLost(failure: PageFailure): { failure: PageFailure; keepReading: boolean } {
  const lead = "keyloom lost track of the install, so it can't say how it is going.";
  if (failsAgain(failure)) return { failure: { ...failure, message: `${lead} ${failure.message}` }, keepReading: false };
  const why = wayOutFor(failure, true) === null ? "" : ` ${failure.message}`;
  return { failure: { ...failure, message: `${lead} It keeps checking by itself.${why}` }, keepReading: true };
}

/**
 * Whether an install has ended, so the page re-reads what is on the computer. Not only a success: a start that failed after the install, or
 * a cancel that came after Homebrew finished, still left the tool there.
 */
export const installEnded = (state: InstallState): boolean => state.status === "succeeded" || state.status === "failed" || state.status === "cancelled";

/** Whether a page that has just opened takes up the install the server reports (R3-13). */
export const adoptOnMount = (state: InstallState): boolean => state.status === "running";

export type Install = {
  state: InstallState | null;
  /** Why the page couldn't start or stop the install; the install itself may still be running. */
  problem: string | null;
  /** `problem` with its code, so one no screen planned for offers Restart keyloom (R9-05, D-540). Optional, with `token`, for hand-built ones. */
  failure?: PageFailure | null;
  token?: string;
  /** The read failure that lost track of the running install (R10-07), kept apart from a failed start or cancel; `problem` says so. */
  lost?: PageFailure | null;
  /** Reads the install at once, after it was lost; absent on hand-built ones. */
  checkAgain?: () => void;
  start: () => void;
  /** Starts keyloom's own download of the tool's pinned release, beside Homebrew (R12-01, R13-02); absent on hand-built ones. */
  download?: () => void;
  /** Stops the running install; it ends `cancelled` once Homebrew has exited. */
  cancel: () => void;
};

/** What the hook knows about one install: the last state read, a failed start or cancel, and the reads that failed in a row. */
export type InstallTrack = { state: InstallState | null; failure: PageFailure | null; lost: ReturnType<typeof installLost> | null; misses: number };
export const INSTALL_IDLE: InstallTrack = { state: null, failure: null, lost: null, misses: 0 };

export type InstallEvent =
  /** The install the server reports when the page opens, taken up only when nothing is shown yet (R3-13). */
  | { kind: "adopt"; state: InstallState }
  /** A read of the install, or a start or cancel the server answered: a fresh state, so earlier misses no longer count. */
  | { kind: "read"; state: InstallState }
  /** A read that failed. A poll's miss counts toward LOST_AFTER; Check again's (`now`) says so at once. */
  | { kind: "miss"; failure: PageFailure; now?: true }
  | { kind: "sent" }
  | { kind: "command_failed"; failure: PageFailure };

/**
 * One step of the install's state. A lost read is newer than a start or cancel that failed before it, so it replaces that failure on screen,
 * and its own failure picks Check again (PR #315 CodeRabbit). A start or cancel the server answered starts the install's state afresh, so a
 * read that stopped polling earlier never keeps a new install from being followed.
 */
export function installTrack(track: InstallTrack, event: InstallEvent): InstallTrack {
  switch (event.kind) {
    case "adopt": return track.state === null ? { ...track, state: event.state } : track;
    case "read": return { ...track, state: event.state, lost: null, misses: 0 };
    case "miss": {
      const misses = track.misses + 1;
      if (event.now !== true && misses < LOST_AFTER) return { ...track, misses };
      return { ...track, misses, failure: null, lost: installLost(event.failure) };
    }
    case "sent": return { ...track, failure: null };
    case "command_failed": return { ...track, failure: event.failure };
  }
}

export function useInstall(token: string, tool: InstallableTool, onDone: () => void): Install {
  const [track, dispatch] = useReducer(installTrack, INSTALL_IDLE);
  const { state, failure, lost } = track;
  // A start or a cancel that failed is the newer thing to say; a lost install says so otherwise.
  const shown = failure ?? lost?.failure ?? null;
  const problem = shown?.message ?? null;
  const done = useRef(onDone);
  done.current = onDone;
  const running = state?.status === "running";
  const reading = running && lost?.keepReading !== false;
  const read = useCallback((next: InstallState) => {
    dispatch({ kind: "read", state: next });
    if (installEnded(next)) done.current();
  }, []);

  // An install started before this page (a reload, another screen) is followed from where it is (R3-13). Only a running one is taken
  // up: an old finished one would bring back a failure the person has already moved past.
  useEffect(() => {
    const controller = new AbortController();
    fetchInstall(token, tool, controller.signal)
      .then((now) => {
        if (adoptOnMount(now)) dispatch({ kind: "adopt", state: now });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [token, tool]);

  useEffect(() => {
    if (!reading) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      fetchInstall(token, tool, controller.signal)
        .then(read)
        // One missed read says nothing: the next one carries on. A few in a row say keyloom lost track of it, so "Installing…" doesn't stay
        // on screen for ever with nothing said (R10-07).
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          dispatch({ kind: "miss", failure: pageFailure(err, "keyloom couldn't read the install.") });
        });
    }, POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [token, tool, reading, read]);

  const checkAgain = useCallback(() => {
    fetchInstall(token, tool)
      .then(read)
      .catch((err: unknown) => dispatch({ kind: "miss", failure: pageFailure(err, "keyloom couldn't read the install."), now: true }));
  }, [token, tool, read]);

  // A start or cancel the server answered is the install's state now, so it is taken as a read without ending it: the poll reports the end.
  const answered = useCallback((next: InstallState) => dispatch({ kind: "read", state: next }), []);

  const begin = useCallback((via?: "download") => {
    dispatch({ kind: "sent" });
    startInstall(token, tool, via)
      .then(answered)
      .catch((err: unknown) => dispatch({ kind: "command_failed", failure: pageFailure(err, via === "download" ? "The download could not start." : "The install could not start.") }));
  }, [token, tool, answered]);
  const start = useCallback(() => begin(), [begin]);
  const download = useCallback(() => begin("download"), [begin]);

  const cancel = useCallback(() => {
    dispatch({ kind: "sent" });
    cancelInstall(token, tool)
      .then(answered)
      .catch((err: unknown) => dispatch({ kind: "command_failed", failure: pageFailure(err, "The install could not be stopped.") }));
  }, [token, tool, answered]);

  return { state, problem, failure: shown, token, lost: lost?.failure ?? null, checkAgain, start, download, cancel };
}
