import { useCallback, useEffect, useRef, useState } from "react";
import type { Build, Flash, FlashCheckResponse } from "../../api/http.ts";
import type { SettingsPaneName } from "../../api/system-remapper.ts";
import { ApiError } from "../api.ts";
import { fetchBuild, fetchFlash, startBuild, startFlash } from "../api-write.ts";
import { type Docker, useDocker } from "./useDocker.ts";
import { type Install, useInstall } from "./useInstall.ts";
import { downloadArtifact, revealArtifact } from "./install-api.ts";
import { cancelShownFlash } from "./cancel-shown-flash.ts";
import { cancelBuild, cancelFlash, checkFlash, openSettings } from "./flash-api.ts";
import { buildCancelProblem } from "./flash-words.ts";
import { fetchRestartLog, restartDockerApp } from "../system.ts";

const POLL_MS = 1000;
// A server that has gone quiet for this many polls in a row is said to be gone; polling goes on, and the line clears when it answers (R2-13).
const MAX_MISSES = 3;
const POLL_LOST = "keyloom stopped answering. Check that it is still running, then try again.";
const BUILD_READ_FAILED = "keyloom couldn't read this build again. Try again to read it.";

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
  /** Stops the running build (R3-10). A build never flashes, so nothing reaches the keyboard. */
  cancelBuild: () => void;
  stoppingBuild: boolean;
  /** Why Cancel didn't stop the build, such as keyloom not answering; the build may still be running. */
  buildCancelProblem: string | null;
  /** Stops a flash that is still waiting for the bootloader (D-501); the server refuses once it writes. */
  cancelFlash: () => void;
  cancelling: boolean;
  /** Why a Cancel didn't stop the flash at once, shown while the flash runs on (D-506). */
  cancelNote: string | null;
  /** Reads what the keyboard runs now, for a flash keyloom couldn't confirm (D-501). It never builds or flashes. */
  checkKeyboard: () => void;
  check: { running: boolean; found: FlashCheckResponse["found"] | null; problem: string | null };
  /** Opens the System Settings pane a permission code names (D-492, D-501). */
  openSettings: (pane: SettingsPaneName) => void;
  settingsProblem: string | null;
  /** Restarts the Docker engine whatever it answers, then builds `revisionId` again, for a `stale_mount` or `stuck_container` (R6-09). */
  restartAndBuild: (revisionId: string) => void;
  /** That restart: running, and why it didn't go through. `again` is false once a restart has failed, so it isn't offered twice (D-511). */
  engineRestart: EngineRestart;
  /** Stops waiting for the work a restart waits for (R7-04); nothing restarts, and the restart is offered again. */
  cancelRestartWait: () => void;
}

/**
 * `running`: the restart request is out. `waitingFor`: the work keyloom waits for before it asks again by itself ("a lab analysis"), or
 * null when it isn't waiting (R7-04). `log`: the restart's progress lines, read while it runs and kept after it fails.
 */
export type EngineRestart = EngineRestartRun & { log: readonly string[] };
/** What `restartThenBuild` shows; the log comes from its own read. */
export type EngineRestartRun = { running: boolean; problem: string | null; again: boolean; waitingFor: readonly string[] | null };

const RESTART_IDLE: EngineRestartRun = { running: false, problem: null, again: true, waitingFor: null };
// How often a waiting restart asks whether the work has ended, and how often a running one reads its progress.
const RESTART_WAIT_MS = 5000;
const RESTART_LOG_MS = 1000;

// What Try again repeats. A start that failed is sent again; a poll that gave up starts polling again; a build read that failed is read again.
type LastAction = { kind: "build"; revisionId: string } | { kind: "flash" } | { kind: "poll" } | { kind: "read" };

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
  const [cancelling, setCancelling] = useState(false);
  const [cancelNoteText, setCancelNote] = useState<string | null>(null);
  const [check, setCheck] = useState<Release["check"]>({ running: false, found: null, problem: null });
  const [settingsProblem, setSettingsProblem] = useState<string | null>(null);
  const [stoppingBuild, setStoppingBuild] = useState(false);
  const [buildCancelProblemText, setBuildCancelProblem] = useState<string | null>(null);
  const [engineRestart, setEngineRestart] = useState<EngineRestartRun>(RESTART_IDLE);
  const [restartLog, setRestartLog] = useState<readonly string[]>([]);
  // Ends the wait a restart is in, if any (R7-04).
  const restartWait = useRef<AbortController | null>(null);
  // Counts build requests, so a restart that ends after a newer one doesn't start its own build over it.
  const buildRequests = useRef(0);
  const docker = useDocker(token);
  const dockerInstall = useInstall(token, "docker", docker.refresh);

  const buildRunning = build?.status === "running";
  const flashActive = flash?.status === "waiting_for_bootloader" || flash?.status === "writing";

  const lost = useCallback(() => {
    setLast({ kind: "poll" });
    setError(POLL_LOST);
  }, []);
  // Only the poll's own line clears: a build or flash that couldn't start keeps its error.
  const found = useCallback(() => setError((now) => (now === POLL_LOST ? null : now)), []);

  useEffect(() => {
    if (build === null || !buildRunning) return;
    return poll((signal) => fetchBuild(token, build.id, signal), setBuild, (next) => next.status !== "running", lost, found);
  }, [token, build?.id, buildRunning, resumes, lost, found]);

  useEffect(() => {
    if (flash === null || !flashActive) return;
    return poll((signal) => fetchFlash(token, flash.id, signal), setFlash, (next) => next.status === "succeeded" || next.status === "failed", lost, found);
  }, [token, flash?.id, flashActive, resumes, lost, found]);

  // Re-reads the build, whose flash plan says whether the flash tool is here now.
  const buildId = build?.id;
  // A read that fails says so in the dialog's callout, whose Try again reads it again (R6-21).
  const refreshBuild = useCallback(() => {
    if (buildId === undefined) return;
    fetchBuild(token, buildId, new AbortController().signal)
      .then((next) => {
        setBuild(next);
        setError((now) => (now === BUILD_READ_FAILED ? null : now));
      })
      .catch(() => {
        setLast({ kind: "read" });
        setError(BUILD_READ_FAILED);
      });
  }, [token, buildId]);
  const toolInstall = useInstall(token, build?.flashPlan.tool?.name ?? "zapp", refreshBuild);

  const buildNow = useCallback(
    (revisionId: string) => {
      buildRequests.current += 1;
      setStarting("build");
      setError(null);
      setLast({ kind: "build", revisionId });
      startBuild(token, layoutRef, revisionId, boardRevision ?? undefined)
        .then((started) => {
          setBuild(started);
          setFlash(null);
        })
        .catch((e: unknown) => {
          // No keyboard to detect: not a failure, a question the panel asks next to the Build button. Only this code asks it (R2-01).
          if (e instanceof ApiError && e.code === "board_revision_needed") setNeeds(true);
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
    setCheck({ running: false, found: null, problem: null });
    setSettingsProblem(null);
    setCancelNote(null);
    // A cancel of the flash this one replaces may still be out; its answer is dropped, so it can't leave this one looking busy.
    setCancelling(false);
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
    else if (last.kind === "read") refreshBuild();
    else setResumes((n) => n + 1);
  }, [last, buildNow, flashNow, refreshBuild]);

  const restartAndBuild = useCallback((revisionId: string) => {
    restartWait.current?.abort();
    const wait = new AbortController();
    restartWait.current = wait;
    setRestartLog([]);
    void restartThenBuild({
      restart: () => restartDockerApp(token, undefined, true),
      waitingFor: () => fetchRestartLog(token).then((log) => log.waitingFor, () => null),
      requests: () => buildRequests.current,
      build: () => buildNow(revisionId),
      show: setEngineRestart,
      signal: wait.signal,
      // Docker may not have come back: the step shows the Docker callout's button from a fresh read (R7-03).
      failed: docker.refresh,
    });
  }, [token, buildNow, docker.refresh]);
  const cancelRestartWait = useCallback(() => restartWait.current?.abort(), []);
  // A new build starts the step afresh, and a restart still waiting for work stops waiting, as it does when the page goes.
  useEffect(() => {
    setEngineRestart(RESTART_IDLE);
    return () => restartWait.current?.abort();
  }, [buildId]);
  // While the restart runs, its progress shows in the build log tail (R7-04). A server without the route gives no lines.
  useEffect(() => {
    if (!engineRestart.running) return;
    const noop = () => {};
    return poll((signal) => fetchRestartLog(token, signal), (log) => {
      if (log.running) setRestartLog((now) => (now.length === log.lines.length && now.at(-1) === log.lines.at(-1) ? now : log.lines));
    }, (log) => !log.running, noop, noop, RESTART_LOG_MS);
  }, [token, engineRestart.running]);

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

  const stopBuild = useCallback(() => {
    if (buildId === undefined || !buildRunning) return;
    const asked = buildId;
    setStoppingBuild(true);
    setBuildCancelProblem(null);
    // The cancel answers at once; "Stopping" stays until the poll sees the build end, which clears it below.
    cancelBuild(token, asked)
      .then(setBuild)
      .catch((e: unknown) => {
        setStoppingBuild(false);
        const code = e instanceof ApiError ? e.code : undefined;
        // It ended before the cancel arrived: the build as it is now says where it got to.
        if (code === "build_finished") refreshBuild();
        else setBuildCancelProblem(buildCancelProblem(code));
      });
  }, [token, buildId, buildRunning, refreshBuild]);
  useEffect(() => {
    if (!buildRunning) setStoppingBuild(false);
  }, [buildRunning]);

  const flashId = flash?.id;
  // The flash on screen now, so a check or a cancel that answers after another flash started can't replace it.
  const currentFlashId = useRef(flashId);
  useEffect(() => {
    currentFlashId.current = flashId;
  }, [flashId]);
  const cancel = useCallback(() => {
    if (flashId === undefined) return;
    const asked = flashId;
    setCancelling(true);
    void cancelShownFlash(asked, {
      cancel: (id) => cancelFlash(token, id),
      read: (id) => fetchFlash(token, id, new AbortController().signal),
      shown: () => currentFlashId.current,
      setFlash,
      setNote: setCancelNote,
    }).finally(() => {
      if (currentFlashId.current === asked) setCancelling(false);
    });
  }, [token, flashId]);

  const checkKeyboard = useCallback(() => {
    // A flash that is starting replaces this one, so its check would answer for a flash no longer on screen.
    if (flashId === undefined || starting !== null) return;
    const asked = flashId;
    setCheck({ running: true, found: null, problem: null });
    checkFlash(token, asked)
      .then((result) => {
        if (currentFlashId.current !== asked) return;
        setFlash(result.flash);
        setCheck({ running: false, found: result.found, problem: null });
      })
      .catch((e: unknown) => {
        if (currentFlashId.current !== asked) return;
        setCheck({ running: false, found: null, problem: e instanceof Error ? e.message : "keyloom couldn't read the keyboard." });
      });
  }, [token, flashId, starting]);

  const open = useCallback((pane: SettingsPaneName) => {
    setSettingsProblem(null);
    openSettings(token, pane)
      .then((result) => {
        if (!result.ok) setSettingsProblem(result.reason);
      })
      .catch((e: unknown) => setSettingsProblem(e instanceof Error ? e.message : "System Settings didn't open."));
  }, [token]);

  return {
    build, flash, starting, error, needsBoardRevision, boardRevision, chooseBoardRevision: setBoardRevision, buildNow, flashNow, retry, docker,
    dockerInstall, toolInstall, download, reveal, checkBuild: refreshBuild, fileProblem,
    cancelBuild: stopBuild, stoppingBuild, buildCancelProblem: buildRunning ? buildCancelProblemText : null,
    cancelFlash: cancel, cancelling, cancelNote: flashActive ? cancelNoteText : null, checkKeyboard, check, openSettings: open, settingsProblem,
    restartAndBuild, engineRestart: { ...engineRestart, log: restartLog }, cancelRestartWait,
  };
}

/** How long a restart waits for running work before it stops waiting and offers the button again (R7-04). */
export const RESTART_WAIT_LIMIT_MS = 30 * 60_000;

/**
 * A forced restart of the engine, then the build it was for. A restart that went through builds again at once. One refused because work
 * runs (a build, a flash, a lab analysis, keyloom's own Docker start) waits while the server names that work, asks every few seconds
 * whether it has ended, and asks for the restart again once it has (R7-04). The restart still checks for itself inside the engine lock,
 * so asking early is refused again and the wait goes on (D-529). A refusal with no work named, or a wait past RESTART_WAIT_LIMIT_MS,
 * shows the reason with the button. One that failed says why and isn't offered again (D-511), and Build again stays. A build asked for
 * while the restart ran or waited is newer: the restart starts nothing over it and says nothing about itself under it, since that build
 * has its own result (PR #297 CodeRabbit).
 */
export async function restartThenBuild(deps: {
  restart: () => Promise<{ ok: true } | { ok: false; reason: string; code?: string | undefined }>;
  /** What a forced restart would wait for now, or null when the server can't say. */
  waitingFor: () => Promise<readonly string[] | null>;
  /** How many builds were asked for so far; `build` adds one. */
  requests: () => number;
  build: () => void;
  show: (state: EngineRestartRun) => void;
  /** Aborted when the person cancels the wait, or a newer build or the page ends it. */
  signal: AbortSignal;
  /** Waits `ms`; a test passes one that returns at once. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Called after a restart that failed, so the page reads Docker again. */
  failed?: () => void;
  now?: () => number;
}): Promise<void> {
  const now = deps.now ?? Date.now;
  const asked = deps.requests();
  const superseded = () => deps.requests() !== asked;
  const sleep = deps.sleep ?? wait;
  const started = now();
  for (;;) {
    deps.show({ ...RESTART_IDLE, running: true });
    let result: Awaited<ReturnType<typeof deps.restart>>;
    try {
      result = await deps.restart();
    } catch (e) {
      deps.show(superseded() ? RESTART_IDLE : { ...RESTART_IDLE, problem: e instanceof Error ? e.message : "keyloom didn't answer, so Docker wasn't restarted." });
      return;
    }
    if (superseded()) return deps.show(RESTART_IDLE);
    if (result.ok) {
      deps.show(RESTART_IDLE);
      deps.build();
      return;
    }
    if (result.code !== "build_running" && result.code !== "engine_busy") {
      deps.show({ ...RESTART_IDLE, problem: result.reason, again: false });
      deps.failed?.();
      return;
    }
    let waitingFor = await deps.waitingFor();
    // Nothing named to wait for: an older server, or work that ended between the refusal and this read. The button stays for either.
    if (waitingFor === null || waitingFor.length === 0) return deps.show({ ...RESTART_IDLE, problem: result.reason });
    while (waitingFor.length > 0) {
      if (now() - started >= RESTART_WAIT_LIMIT_MS) {
        return deps.show({ ...RESTART_IDLE, problem: "keyloom waited 30 minutes and that work is still running, so it stopped waiting. Restart once it has ended." });
      }
      deps.show({ ...RESTART_IDLE, waitingFor });
      await sleep(RESTART_WAIT_MS, deps.signal);
      if (deps.signal.aborted || superseded()) return deps.show(RESTART_IDLE);
      // A read that fails keeps waiting on what it last named.
      waitingFor = (await deps.waitingFor()) ?? waitingFor;
    }
  }
}

/** Resolves after `ms`, or at once when `signal` aborts. */
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => {
    clearTimeout(timer);
    resolve();
  }, { once: true });
});

// Calls `fetchNext` every POLL_MS until `isDone`. After MAX_MISSES misses in a row it calls `lost` once and keeps asking, and `found`
// when an answer comes back, so the page's line clears by itself once keyloom answers again (R2-13). Returns the cleanup that stops it.
export function poll<T>(
  fetchNext: (signal: AbortSignal) => Promise<T>,
  publish: (value: T) => void,
  isDone: (value: T) => boolean,
  lost: () => void,
  found: () => void,
  everyMs = POLL_MS,
): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let misses = 0;
  const schedule = () => {
    timer = setTimeout(async () => {
      try {
        const next = await fetchNext(controller.signal);
        if (controller.signal.aborted) return;
        if (misses >= MAX_MISSES) found();
        misses = 0;
        publish(next);
        if (isDone(next)) return;
      } catch {
        if (controller.signal.aborted) return;
        misses += 1;
        if (misses === MAX_MISSES) lost();
      }
      schedule();
    }, everyMs);
  };
  schedule();
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
