// Whether the Docker a firmware build needs is up, for the release dialog (D-486). keyloom starts the engine
// itself, so this only ever says what is happening or what is missing, and offers the click when it can't.
import { useCallback, useEffect, useState } from "react";
import type { DockerReadinessResponse } from "../../api/system.ts";
import type { DockerStartResponse } from "../../api/system.ts";
import { fetchDockerReadiness, restartDockerApp, startDockerEngine } from "../system.ts";

export type Docker = {
  /** Null when the server offers no system routes, or the page hasn't asked yet. */
  readiness: DockerReadinessResponse | null;
  /** The last readiness request failed, so `readiness` is null because the page couldn't ask, not because it hasn't yet. */
  unanswered: boolean;
  /** A start or restart from this page is running. */
  starting: boolean;
  /** Why a start or restart from this page failed. */
  problem: string | null;
  /** What this page last asked for, so a restart that failed isn't offered as the way on again (R3-04). */
  lastAction: "start" | "restart" | null;
  /** Starts the engine; for `cli-missing` the server opens the app instead (R2-07). */
  start: () => void;
  /** Quits and reopens the Mac app, for `no-access` (R2-07), or stops and starts Colima when it won't start (R3-04). */
  restart: () => void;
  refresh: () => void;
};

export function useDocker(token: string): Docker {
  const [readiness, setReadiness] = useState<DockerReadinessResponse | null>(null);
  const [unanswered, setUnanswered] = useState(false);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<Docker["lastAction"]>(null);
  const [asks, setAsks] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchDockerReadiness(token, controller.signal)
      .then((next) => {
        setReadiness(next);
        setUnanswered(false);
        // A failed start no longer says anything once Docker answers.
        if (next?.ok === true) setProblem(null);
      })
      // A server without the route, or one that can't answer, leaves the dialog without this line rather than failing it.
      .catch(() => {
        if (controller.signal.aborted) return;
        setReadiness(null);
        setUnanswered(true);
      });
    return () => controller.abort();
  }, [token, asks]);

  const run = useCallback((action: "start" | "restart", ask: (token: string) => Promise<DockerStartResponse>) => {
    setStarting(true);
    setProblem(null);
    setLastAction(action);
    ask(token)
      .then((result) => {
        if (result.ok) setReadiness((previous) => ({ ok: true, version: result.version, engine: result.engine, autoStart: previous?.autoStart ?? true }));
        else setProblem(result.reason);
      })
      .catch((err: unknown) => setProblem(err instanceof Error ? err.message : "Docker could not be started."))
      .finally(() => setStarting(false));
  }, [token]);
  const start = useCallback(() => run("start", startDockerEngine), [run]);
  const restart = useCallback(() => run("restart", restartDockerApp), [run]);

  const refresh = useCallback(() => setAsks((n) => n + 1), []);
  return { readiness, unanswered, starting, problem, lastAction, start, restart, refresh };
}

const RECHECK_MS = 4000;

/**
 * While the dialog is open and Docker is missing, asks again every few seconds, so a Docker installed some other way
 * (Docker Desktop's installer, a terminal) shows as ready without the person pressing Check again (D-488).
 */
export function useDockerRecheck(docker: Docker, active: boolean): void {
  const { refresh } = docker;
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(refresh, RECHECK_MS);
    return () => window.clearInterval(timer);
  }, [refresh, active]);
}
