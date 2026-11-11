import { useCallback, useEffect, useState } from "react";
import type { Build, Flash } from "../../api/http.ts";
import { ApiError } from "../api.ts";
import { fetchBuild, fetchFlash, startBuild, startFlash } from "../api-write.ts";
import { type Docker, useDocker } from "./useDocker.ts";
import { type Install, useInstall } from "./useInstall.ts";
import { downloadArtifact, revealArtifact } from "./install-api.ts";

const POLL_MS = 1000;
// A server that has gone quiet for this many polls in a row is treated as gone, not slow.
const MAX_MISSES = 3;

export interface Release {
  build: Build | null;
  flash: Flash | null;
  starting: "build" | "flash" | null;
  /** Why starting a build or flash failed, or why polling gave up. */
  error: string | null;
  /** True once the server has asked which board revision to build for. */
  needsBoardRevision: boolean;
  /** The revision chosen this session, such as "reva"; kept until the page is reloaded. */
  boardRevision: string | null;
  chooseBoardRevision: (revision: string) => void;
  buildNow: (revisionId: string) => void;
  flashNow: () => void;
  /** Repeats what failed: the build or flash that couldn't start, or the polling that gave up (R1-10). */
  retry: () => void;
  /** The Docker a build needs: up, starting, or what is missing (D-486). */
  docker: Docker;
  /** Installing Docker from the dialog (D-488). */
  dockerInstall: Install;
  /** Installing the tool this build's flash runs, such as Zapp (D-489). */
  toolInstall: Install;
  /** Saves the build's firmware file, or shows it in Finder, for a board keyloom can't flash (D-490). */
  download: () => void;
  reveal: () => void;
  /** Reads the build again, so its flash plan says whether the flash tool is here now. */
  checkBuild: () => void;
  /** Why a download or reveal failed. */
  fileProblem: string | null;
}

// What Try again repeats. A start that failed is sent again; a poll that gave up starts polling again.
type LastAction = { kind: "build"; revisionId: string } | { kind: "flash" } | { kind: "poll" };

// Starts builds and flashes and follows them once a second until they finish. Nothing here
// starts a flash by itself: flashNow only runs from an explicit click.
export function useRelease(token: string, layoutRef: string): Release {
  const [build, setBuild] = useState<Build | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [starting, setStarting] = useState<Release["starting"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [resumes, setResumes] = useState(0);
  const [last, setLast] = useState<LastAction>({ kind: "poll" });
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [needsBoardRevision, setNeeds] = useState(false);
  const [boardRevision, setBoardRevision] = useState<string | null>(null);
  const docker = useDocker(token);
  const dockerInstall = useInstall(token, "docker", docker.refresh);

  const buildRunning = build?.status === "running";
  const flashActive = flash?.status === "waiting_for_bootloader" || flash?.status === "writing";

  useEffect(() => {
    if (build === null || !buildRunning) return;
    return poll((signal) => fetchBuild(token, build.id, signal), setBuild, (next) => next.status !== "running", (message) => { setLast({ kind: "poll" }); setError(message); });
  }, [token, build?.id, buildRunning, resumes]);

  useEffect(() => {
    if (flash === null || !flashActive) return;
    return poll((signal) => fetchFlash(token, flash.id, signal), setFlash, (next) => next.status === "succeeded" || next.status === "failed", (message) => { setLast({ kind: "poll" }); setError(message); });
  }, [token, flash?.id, flashActive, resumes]);

  // Re-reads the build, whose flash plan says whether the flash tool is here now.
  const buildId = build?.id;
  const refreshBuild = useCallback(() => {
    if (buildId === undefined) return;
    fetchBuild(token, buildId, new AbortController().signal).then(setBuild).catch(() => undefined);
  }, [token, buildId]);
  const toolInstall = useInstall(token, build?.flashPlan.tool?.name ?? "zapp", refreshBuild);

  const buildNow = useCallback(
    (revisionId: string) => {
      setStarting("build");
      setError(null);
      setLast({ kind: "build", revisionId });
      startBuild(token, layoutRef, revisionId, boardRevision ?? undefined)
        .then((started) => {
          setBuild(started);
          setFlash(null);
        })
        .catch((e: unknown) => {
          // No keyboard to detect: not a failure, a question the panel asks next to the Build button.
          if (e instanceof ApiError && e.code === "usage") setNeeds(true);
          else setError(e instanceof Error ? e.message : "The build could not start.");
        })
        .finally(() => setStarting(null));
    },
    [token, layoutRef, boardRevision],
  );

  const flashNow = useCallback(() => {
    if (build === null) return;
    setStarting("flash");
    setError(null);
    setLast({ kind: "flash" });
    startFlash(token, build.id)
      .then(setFlash)
      .catch((e: unknown) => {
        // The tool went missing since the build was read: the step shows its Install button once the build is read again.
        if (e instanceof ApiError && e.code === "flash_tool_missing") refreshBuild();
        else setError(e instanceof Error ? e.message : "Flashing could not start.");
      })
      .finally(() => setStarting(null));
  }, [token, build, refreshBuild]);

  const retry = useCallback(() => {
    setError(null);
    if (last.kind === "build") buildNow(last.revisionId);
    else if (last.kind === "flash") flashNow();
    else setResumes((n) => n + 1);
  }, [last, buildNow, flashNow]);

  const download = useCallback(() => {
    if (buildId === undefined) return;
    setFileProblem(null);
    downloadArtifact(token, buildId).catch((e: unknown) => setFileProblem(e instanceof Error ? e.message : "The file couldn't be downloaded."));
  }, [token, buildId]);

  const reveal = useCallback(() => {
    if (buildId === undefined) return;
    setFileProblem(null);
    revealArtifact(token, buildId).catch((e: unknown) => setFileProblem(e instanceof Error ? e.message : "Finder couldn't show the file."));
  }, [token, buildId]);

  return {
    build, flash, starting, error, needsBoardRevision, boardRevision, chooseBoardRevision: setBoardRevision, buildNow, flashNow, retry, docker,
    dockerInstall, toolInstall, download, reveal, checkBuild: refreshBuild, fileProblem,
  };
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
