// One install from a button (D-488, D-489): starts it, follows its output once a second until it finishes, and calls
// `onDone` when it succeeded so the dialog re-reads what is now on the computer.
import { useCallback, useEffect, useRef, useState } from "react";
import type { InstallState, InstallableTool } from "../../api/tool-install.ts";
import { fetchInstall, startInstall } from "./install-api.ts";

const POLL_MS = 1000;

export type Install = {
  state: InstallState | null;
  /** Why the page couldn't start or follow the install; the install itself may still be running. */
  problem: string | null;
  start: () => void;
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
    let misses = 0;
    const timer = window.setInterval(() => {
      fetchInstall(token, tool, controller.signal)
        .then((next) => {
          misses = 0;
          setState(next);
          if (next.status === "succeeded") done.current();
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          misses += 1;
          if (misses === 3) setProblem("keyloom stopped answering while it installed. Check that it is still running.");
        });
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

  return { state, problem, start };
}
