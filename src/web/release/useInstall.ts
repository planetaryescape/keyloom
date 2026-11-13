// One install from a button (D-488, D-489): starts it, follows its output once a second until it finishes, and calls
// `onDone` when it ends so the dialog re-reads what is now on the computer. It can be cancelled (R2-08).
import { useCallback, useEffect, useRef, useState } from "react";
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
  /** Reads of the running install kept failing (R10-07); `problem` says so. */
  lost?: boolean;
  /** Reads the install at once, after it was lost; absent on hand-built ones. */
  checkAgain?: () => void;
  start: () => void;
  /** Stops the running install; it ends `cancelled` once Homebrew has exited. */
  cancel: () => void;
};

export function useInstall(token: string, tool: InstallableTool, onDone: () => void): Install {
  const [state, setState] = useState<InstallState | null>(null);
  const [failure, setFailure] = useState<PageFailure | null>(null);
  const [lost, setLost] = useState<ReturnType<typeof installLost> | null>(null);
  // A start or a cancel that failed is the newer thing to say; a lost install says so otherwise.
  const shown = failure ?? lost?.failure ?? null;
  const problem = shown?.message ?? null;
  const done = useRef(onDone);
  done.current = onDone;
  const running = state?.status === "running";
  const reading = running && lost?.keepReading !== false;
  const misses = useRef(0);
  const read = useCallback((next: InstallState) => {
    misses.current = 0;
    setLost(null);
    setState(next);
    if (installEnded(next)) done.current();
  }, []);

  // An install started before this page (a reload, another screen) is followed from where it is (R3-13). Only a running one is taken
  // up: an old finished one would bring back a failure the person has already moved past.
  useEffect(() => {
    const controller = new AbortController();
    fetchInstall(token, tool, controller.signal)
      .then((now) => {
        if (adoptOnMount(now)) setState((shown) => shown ?? now);
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
          misses.current += 1;
          if (misses.current >= LOST_AFTER) setLost(installLost(pageFailure(err, "keyloom couldn't read the install.")));
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
      .catch((err: unknown) => setLost(installLost(pageFailure(err, "keyloom couldn't read the install."))));
  }, [token, tool, read]);

  const start = useCallback(() => {
    setFailure(null);
    startInstall(token, tool)
      .then(setState)
      .catch((err: unknown) => setFailure(pageFailure(err, "The install could not start.")));
  }, [token, tool]);

  const cancel = useCallback(() => {
    setFailure(null);
    cancelInstall(token, tool)
      .then(setState)
      .catch((err: unknown) => setFailure(pageFailure(err, "The install could not be stopped.")));
  }, [token, tool]);

  return { state, problem, failure: shown, token, lost: lost !== null, checkAgain, start, cancel };
}
