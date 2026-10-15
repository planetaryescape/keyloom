import { useCallback, useEffect, useState } from "react";
import type { Build, Flash } from "../../api/http.ts";
import { fetchBuild, fetchFlash, startBuild, startFlash } from "../api-write.ts";

const POLL_MS = 1000;
// A server that has gone quiet for this many polls in a row is treated as gone, not slow.
const MAX_MISSES = 3;

export interface Release {
  build: Build | null;
  flash: Flash | null;
  starting: "build" | "flash" | null;
  /** Why starting a build or flash failed, or why polling gave up. */
  error: string | null;
  buildNow: (revisionId: string) => void;
  flashNow: () => void;
  /** Polls again after the server could not be reached. */
  resume: () => void;
}

// Starts builds and flashes and follows them once a second until they finish. Nothing here
// starts a flash by itself: flashNow only runs from an explicit click.
export function useRelease(token: string, layoutRef: string): Release {
  const [build, setBuild] = useState<Build | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [starting, setStarting] = useState<Release["starting"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [resumes, setResumes] = useState(0);

  const buildRunning = build?.status === "running";
  const flashActive = flash?.status === "waiting_for_bootloader" || flash?.status === "writing";

  useEffect(() => {
    if (build === null || !buildRunning) return;
    return poll((signal) => fetchBuild(token, build.id, signal), setBuild, (next) => next.status !== "running", setError);
  }, [token, build?.id, buildRunning, resumes]);

  useEffect(() => {
    if (flash === null || !flashActive) return;
    return poll((signal) => fetchFlash(token, flash.id, signal), setFlash, (next) => next.status === "succeeded" || next.status === "failed", setError);
  }, [token, flash?.id, flashActive, resumes]);

  const buildNow = useCallback(
    (revisionId: string) => {
      setStarting("build");
      setError(null);
      startBuild(token, layoutRef, revisionId)
        .then((started) => {
          setBuild(started);
          setFlash(null);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : "The build could not start."))
        .finally(() => setStarting(null));
    },
    [token, layoutRef],
  );

  const flashNow = useCallback(() => {
    if (build === null) return;
    setStarting("flash");
    setError(null);
    startFlash(token, build.id)
      .then(setFlash)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Flashing could not start."))
      .finally(() => setStarting(null));
  }, [token, build]);

  const resume = useCallback(() => {
    setError(null);
    setResumes((n) => n + 1);
  }, []);

  return { build, flash, starting, error, buildNow, flashNow, resume };
}

// Calls `fetchNext` every POLL_MS until `isDone`. Returns the cleanup that stops it.
function poll<T>(
  fetchNext: (signal: AbortSignal) => Promise<T>,
  publish: (value: T) => void,
  isDone: (value: T) => boolean,
  fail: (message: string) => void,
): () => void {
  const controller = new AbortController();
  let timer: number | undefined;
  let misses = 0;
  const schedule = () => {
    timer = window.setTimeout(async () => {
      try {
        const next = await fetchNext(controller.signal);
        misses = 0;
        publish(next);
        if (isDone(next)) return;
      } catch {
        if (controller.signal.aborted) return;
        misses += 1;
        if (misses >= MAX_MISSES) {
          fail("keyloom stopped answering. Check that it is still running, then try again.");
          return;
        }
      }
      schedule();
    }, POLL_MS);
  };
  schedule();
  return () => {
    controller.abort();
    window.clearTimeout(timer);
  };
}
