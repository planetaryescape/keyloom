// Whether the Docker a firmware build needs is up, for the release dialog (D-486). keyloom starts the engine
// itself, so this only ever says what is happening or what is missing, and offers the click when it can't.
import { useCallback, useEffect, useState } from "react";
import type { DockerReadinessResponse } from "../../api/system.ts";
import type { DockerStartResponse } from "../../api/system.ts";
import { fetchDockerReadiness, fixColimaFiles, restartDockerApp, startDockerEngine } from "../system.ts";
import { linkedFileAfter } from "./release-words.ts";

export type Docker = {
  /** Null when the server offers no system routes, or the page hasn't asked yet. */
  readiness: DockerReadinessResponse | null;
  /** The last readiness request failed, so `readiness` is null because the page couldn't ask, not because it hasn't yet. */
  unanswered: boolean;
  /** A start or restart from this page is running. */
  starting: boolean;
  /** Why a start or restart from this page failed. */
  problem: string | null;
  /** The server's code for `problem`, such as `cancelled` for a password dialog the person closed (D-533). */
  problemCode: DockerStartCode | null;
  /**
   * Fix Colima's files found a file with a second name, and no fix has completed since, so the page holds back Colima's `chown -R`
   * command. Kept apart from `problemCode`, which the next press replaces (PR #300 CodeRabbit).
   */
  linkedFile: boolean;
  /** What this page last asked for, so a restart that failed isn't offered as the way on again (R3-04). */
  lastAction: DockerAction | null;
  /** Starts the engine; for `cli-missing` the server opens the app instead (R2-07). */
  start: () => void;
  /** Quits and reopens the Mac app, for `no-access` (R2-07), or stops and starts Colima when it won't start (R3-04). */
  restart: () => void;
  /** Fix Colima's files (D-533): macOS's password dialog, then the files go back to the person and Colima starts as them. */
  fixFiles: () => void;
  refresh: () => void;
};

export type DockerAction = "start" | "restart" | "fix-files";
type DockerStartCode = NonNullable<Extract<DockerStartResponse, { ok: false }>["code"]>;

export function useDocker(token: string): Docker {
  const [readiness, setReadiness] = useState<DockerReadinessResponse | null>(null);
  const [unanswered, setUnanswered] = useState(false);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [problemCode, setProblemCode] = useState<Docker["problemCode"]>(null);
  const [lastAction, setLastAction] = useState<Docker["lastAction"]>(null);
  const [linkedFile, setLinkedFile] = useState(false);
  const [asks, setAsks] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let again: ReturnType<typeof setTimeout> | undefined;
    fetchDockerReadiness(token, controller.signal)
      .then((next) => {
        setReadiness(next);
        setUnanswered(false);
        // A failed start no longer says anything once Docker answers.
        if (next?.ok === true) setProblem(null);
        // While keyloom starts the engine for something else, ask again once this answer is in, so the page follows that start to Docker
        // up or its failure. Asking only after an answer keeps a slow readiness from being cut off by the next ask (#290 review).
        if (next !== null && !next.ok && next.engineAction != null && !controller.signal.aborted) again = setTimeout(() => setAsks((n) => n + 1), ENGINE_ACTION_POLL_MS);
      })
      // A server without the route, or one that can't answer, leaves the dialog without this line rather than failing it.
      .catch(() => {
        if (controller.signal.aborted) return;
        setReadiness(null);
        setUnanswered(true);
      });
    return () => {
      controller.abort();
      clearTimeout(again);
    };
  }, [token, asks]);

  const run = useCallback((action: DockerAction, ask: (token: string) => Promise<DockerStartResponse>) => {
    setStarting(true);
    setProblem(null);
    setProblemCode(null);
    const before = lastAction;
    setLastAction(action);
    ask(token)
      .then((result) => {
        setLinkedFile((before) => linkedFileAfter(before, action, result));
        if (result.ok) setReadiness((previous) => ({ ok: true, version: result.version, engine: result.engine, autoStart: previous?.autoStart ?? true }));
        else if (result.code === "engine_busy") {
          // keyloom is already starting the engine (R4-04): nothing failed, so nothing is recorded, and the readiness follows that start.
          setLastAction(before);
          // Shown as starting until the readiness asked for below says which action runs, so the button doesn't come back meanwhile.
          setReadiness((previous) => (previous !== null && !previous.ok && previous.engineAction == null ? { ...previous, engineAction: "start" } : previous));
          setAsks((n) => n + 1);
        } else {
          setProblem(result.reason);
          setProblemCode(result.code ?? null);
        }
        // Fixing Colima's files changes what Docker needs, so the page asks again by itself rather than keep the old answer (D-533).
        if (action === "fix-files") setAsks((n) => n + 1);
      })
      .catch((err: unknown) => setProblem(err instanceof Error ? err.message : "Docker could not be started."))
      .finally(() => setStarting(false));
  }, [token, lastAction]);
  const start = useCallback(() => run("start", startDockerEngine), [run]);
  const restart = useCallback(() => run("restart", restartDockerApp), [run]);
  const fixFiles = useCallback(() => run("fix-files", fixColimaFiles), [run]);

  const refresh = useCallback(() => setAsks((n) => n + 1), []);
  return { readiness, unanswered, starting, problem, problemCode, linkedFile, lastAction, start, restart, fixFiles, refresh };
}

const ENGINE_ACTION_POLL_MS = 2000;

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
