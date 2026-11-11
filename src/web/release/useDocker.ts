// Whether the Docker a firmware build needs is up, for the release dialog (D-486). keyloom starts the engine
// itself, so this only ever says what is happening or what is missing, and offers the click when it can't.
import { useCallback, useEffect, useState } from "react";
import type { DockerReadinessResponse } from "../../api/system.ts";
import { fetchDockerReadiness, startDockerEngine } from "../system.ts";

export type Docker = {
  /** Null when the server offers no system routes, or the page hasn't asked yet. */
  readiness: DockerReadinessResponse | null;
  /** A start from this page is running. */
  starting: boolean;
  /** Why a start from this page failed. */
  problem: string | null;
  start: () => void;
  refresh: () => void;
};

export function useDocker(token: string): Docker {
  const [readiness, setReadiness] = useState<DockerReadinessResponse | null>(null);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [asks, setAsks] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchDockerReadiness(token, controller.signal)
      .then(setReadiness)
      // A server without the route, or one that can't answer, leaves the dialog without this line rather than failing it.
      .catch(() => setReadiness(null));
    return () => controller.abort();
  }, [token, asks]);

  const start = useCallback(() => {
    setStarting(true);
    setProblem(null);
    startDockerEngine(token)
      .then((result) => {
        if (result.ok) setReadiness((previous) => ({ ok: true, version: result.version, engine: result.engine, autoStart: previous?.autoStart ?? true }));
        else setProblem(result.reason);
      })
      .catch((err: unknown) => setProblem(err instanceof Error ? err.message : "Docker could not be started."))
      .finally(() => setStarting(false));
  }, [token]);

  const refresh = useCallback(() => setAsks((n) => n + 1), []);
  return { readiness, starting, problem, start, refresh };
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
