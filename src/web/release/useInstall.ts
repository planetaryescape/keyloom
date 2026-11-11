// One install from a button (D-488, D-489): starts it, follows its output once a second until it finishes, and calls
// `onDone` when it succeeded so the dialog re-reads what is now on the computer. It can be cancelled (R2-08).
import { useCallback, useEffect, useRef, useState } from "react";
import type { InstallState, InstallableTool } from "../../api/tool-install.ts";
import { cancelInstall, fetchInstall, startInstall } from "./install-api.ts";

const POLL_MS = 1000;

export type Install = {
  state: InstallState | null;
  /** Why the page couldn't start or stop the install; the install itself may still be running. */
  problem: string | null;
  start: () => void;
  /** Stops the running install; it ends `cancelled` once Homebrew has exited. */
  cancel: () => void;
};

export function useInstall(token: string, tool: InstallableTool, onDone: () => void): Install {
  const [state, setState] = useState<InstallState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  const running = state?.status === "running";

  useEffect(() => {
    if (!running) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      fetchInstall(token, tool, controller.signal)
        .then((next) => {
          setState(next);
          if (next.status === "succeeded") done.current();
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
    setProblem(null);
    startInstall(token, tool)
      .then(setState)
      .catch((err: unknown) => setProblem(err instanceof Error ? err.message : "The install could not start."));
  }, [token, tool]);

  const cancel = useCallback(() => {
    setProblem(null);
    cancelInstall(token, tool)
      .then(setState)
      .catch((err: unknown) => setProblem(err instanceof Error ? err.message : "The install could not be stopped."));
  }, [token, tool]);

  return { state, problem, start, cancel };
}
