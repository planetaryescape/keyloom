// One install from a button (D-488, D-489): starts it, follows its output once a second until it finishes, and calls
// `onDone` when it ends so the dialog re-reads what is now on the computer. It can be cancelled (R2-08).
import { useCallback, useEffect, useRef, useState } from "react";
import type { InstallState, InstallableTool } from "../../api/tool-install.ts";
import { cancelInstall, fetchInstall, startInstall } from "./install-api.ts";
import { type PageFailure, pageFailure } from "../shell/unexpected.ts";

const POLL_MS = 1000;

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
  start: () => void;
  /** Stops the running install; it ends `cancelled` once Homebrew has exited. */
  cancel: () => void;
};

export function useInstall(token: string, tool: InstallableTool, onDone: () => void): Install {
  const [state, setState] = useState<InstallState | null>(null);
  const [failure, setFailure] = useState<PageFailure | null>(null);
  const problem = failure?.message ?? null;
  const done = useRef(onDone);
  done.current = onDone;
  const running = state?.status === "running";

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
    if (!running) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      fetchInstall(token, tool, controller.signal)
        .then((next) => {
          setState(next);
          if (installEnded(next)) done.current();
        })
        // A missed poll says nothing of its own: a server that stopped answering gets the page's own banner (R2-13), and the next poll carries on.
        .catch(() => undefined);
    }, POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [token, tool, running]);

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

  return { state, problem, failure, token, start, cancel };
}
