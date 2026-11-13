import { CircleAlert, CircleCheck, Eraser, ExternalLink, Hammer, LoaderCircle, MessageCircle, Pause, Play, RefreshCw, Settings, TriangleAlert, Undo2, X, Zap } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Build, Flash, RevisionInfo } from "../../api/http.ts";
import type { BoardDefinition } from "../../boards/schema.ts";
import { ChoiceGroup } from "../editor/ChoiceGroup.tsx";
import { LogTail } from "./LogTail.tsx";
import { elapsedOf, type ReleaseStatus } from "./status.ts";
import type { Release } from "./useRelease.ts";
import { useDockerRecheck } from "./useDocker.ts";
import { DockerCallout } from "./DockerCallout.tsx";
import { ManualFlash, ToolCallout } from "./FlashPrerequisites.tsx";
import { buildBlockedReason, buildDisabledReason, dockerView, flashStepView, plain, recheckDocker } from "./release-words.ts";
import { headline } from "../../layout/history-summary.ts";
import { BUILD_FILE_GONE, SYNC_BUILD_GONE_CODE, checkOutcome, errorWayOut, failedFlashText, permissionFix, revisionChoices } from "./flash-words.ts";
import { buildFailureView, engineRestartLog, linuxBrowser, restartWaitText, type GoBackProblem, goBackProblem, shownGoBackProblem, type WentBack, wentBackSummary } from "./build-failure-words.ts";
import { CopyCommand } from "../shell/CopyCommand.tsx";
import { RestartKeyloom } from "../shell/RestartKeyloom.tsx";
import { FailureNote, UnexpectedWayOut } from "../shell/UnexpectedWayOut.tsx";
import { failsAgain, wayOutFor } from "../shell/unexpected.ts";
import "./release.css";

interface Props {
  token: string;
  open: boolean;
  onClose: () => void;
  release: Release;
  /** The revision a build would be made from: the head, or an earlier one chosen in History. */
  head: Pick<RevisionInfo, "id" | "summary">;
  /** True when `head` is not the latest revision, so the dialog says it is flashing an earlier one. */
  earlierRevision?: boolean;
  /** The keyboard's auto-sync, which puts the latest layout back after a flash of an earlier revision unless it is paused. */
  autoSync?: { on: boolean; paused: boolean; onPause: () => void; onResume?: () => void } | null;
  boardName: string;
  /** The board's hardware revisions, for "Which <board> is this?". */
  boardRevisions: BoardDefinition["revisions"];
  status: ReleaseStatus;
  now: number;
  /** Goes back to an earlier revision as a new one (D-502), then shows it; for a build that fails the same way every time (R5-02). */
  onGoBack: (to: string) => Promise<void>;
  /** Reads the layout again, after the server refused Go back because the layout had moved on (D-506). */
  onShowLatest: () => Promise<void>;
  /** Closes the dialog and puts a question about this build, with its log, in the chat for the person to send (R5-02). */
  onAskAboutBuild: (build: Build) => void;
}

type StepState = "todo" | "active" | "done" | "failed" | "warning" | "locked";

function Step({ number, title, state, aside, children }: { number: number; title: string; state: StepState; aside?: string; children: ReactNode }) {
  return (
    <li className="step" data-state={state}>
      <span className="step-mark" aria-hidden="true">
        {state === "done" ? <CircleCheck size={20} /> : state === "failed" ? <CircleAlert size={20} /> : state === "warning" ? <TriangleAlert size={20} /> : number}
      </span>
      <div className="step-body">
        <div className="step-head">
          <h3>{title}</h3>
          {aside === undefined ? null : <span className="step-aside">{aside}</span>}
        </div>
        {children}
      </div>
    </li>
  );
}

/** What macOS refused, with the button that opens the pane where it is allowed (D-501). */
function PermissionFix({ token, code, release }: { token: string; code: Parameters<typeof permissionFix>[0]; release: Release }) {
  const fix = permissionFix(code);
  if (fix === null) return null;
  return (
    <div className="release-docker" role="status">
      <span>{fix.text}</span>
      <button type="button" className="button" onClick={() => release.openSettings(fix.pane)}>
        <Settings size={14} aria-hidden="true" />
        {fix.button}
      </button>
      {release.settingsProblem === null ? null : <FailureNote token={token} failure={release.settingsProblem} className="blocked-reason" />}
    </div>
  );
}

function Progress({ label }: { label: string }) {
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-busy="true">
      <span />
    </div>
  );
}

export function ReleaseDialog({ token, open, onClose, release, head, earlierRevision = false, autoSync = null, boardName, boardRevisions, status, now, onGoBack, onShowLatest, onAskAboutBuild }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState(false);
  // Go back to the last version that built (R5-02): while it runs, what the server refused, and the revision it went back to. Both
  // belong to one build, so a later build never shows an older build's refusal or "back to" line.
  const [goingBack, setGoingBack] = useState(false);
  const [goBackRefusedState, setGoBackRefused] = useState<GoBackProblem | null>(null);
  const [wentBackTo, setWentBackTo] = useState<WentBack | null>(null);
  const { build: lastBuild, flash: lastFlash, starting, error, docker } = release;
  // The revision on screen now, read by a restart that waits, so it never builds one the dialog no longer shows (PR #303 review).
  const shownHead = useRef(head.id);
  useEffect(() => {
    shownHead.current = head.id;
  }, [head.id]);
  const lastBuildId = lastBuild?.id ?? null;
  const goBackRefused = shownGoBackProblem(goBackRefusedState, lastBuildId);
  // Record the revision the Go back made, so wentBackSummary can tell it from a later edit.
  useEffect(() => {
    if (wentBackTo !== null && wentBackTo.toHead === null && head.id !== wentBackTo.fromHead) setWentBackTo({ ...wentBackTo, toHead: head.id });
  }, [head.id, wentBackTo]);
  const wentBack = wentBackSummary(wentBackTo, lastBuildId, head.id);
  const dockerNow = dockerView(docker.readiness, docker.starting, docker.problem, release.dockerInstall.state, docker.lastAction, docker.problemCode, docker.linkedFile);
  const blocked = buildBlockedReason(dockerNow);
  const buildOff = buildDisabledReason(blocked, release.needsBoardRevision, release.boardRevision, boardName);
  // While Docker is missing, the dialog asks again by itself, so installing it elsewhere needs no click here (D-488).
  useDockerRecheck(docker, open && recheckDocker(dockerNow));

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  // A build of an older revision says nothing about the one on screen, so it is not shown as a result. A build the person stopped is
  // the Build firmware step again, with a line that says so (R3-10).
  const shownBuild = lastBuild !== null && lastBuild.revisionId === head.id ? lastBuild : null;
  const buildStopped = shownBuild?.status === "failed" && shownBuild.errorCode === "cancelled";
  // A read that found the build gone (`sync_build_gone`) leaves the old build in the hook: the step shows Build firmware, as its words say,
  // and no flash of a build keyloom no longer has (PR #315 review).
  const buildGone = release.errorCode === SYNC_BUILD_GONE_CODE;
  const build = buildStopped || buildGone ? null : shownBuild;
  const flash = build !== null && lastFlash !== null && lastFlash.buildId === build.id ? lastFlash : null;
  const earlier = lastBuild !== null && shownBuild === null;
  const flashing = flash?.status === "waiting_for_bootloader" || flash?.status === "writing";
  // A build whose file is gone can't be flashed again; Build again above makes one that can (R8-12).
  const errorWay = errorWayOut(release.errorCode, release.errorGeneric);
  const fileGone = errorWay === "build_again";
  const canFlash = build?.status === "succeeded" && !flashing && !fileGone;
  const flashPlan = build === null ? null : flashStepView(build.flashPlan);

  const buildState: StepState = build === null ? "todo" : build.status === "running" ? "active" : build.status === "succeeded" ? "done" : "failed";
  // On Linux, an engine keyloom can't restart gets the line that does (R11-10). The page runs on the computer keyloom serves.
  const host = { linux: typeof navigator !== "undefined" && linuxBrowser(navigator.userAgent), engine: docker.readiness?.ok === true ? docker.readiness.engine : null };
  const failure = build?.status === "failed" ? buildFailureView(build, earlierRevision, !release.engineRestart.again, host) : null;
  // A failed read of the latest version keeps "Show the latest version" with its reason.
  const showLatest = (failed: string) =>
    onShowLatest().then(() => setGoBackRefused(null), () => setGoBackRefused({ text: failed, next: "reload", buildId: lastBuildId, retry: false }));
  const goBack = async (to: { revisionId: string; summary: string }) => {
    setGoingBack(true);
    setGoBackRefused(null);
    try {
      await onGoBack(to.revisionId);
      setWentBackTo({ summary: to.summary, buildId: lastBuildId, fromHead: head.id, toHead: null });
      // The new revision is made; Go back stays hidden after this, so it can't be made twice.
      await showLatest(`keyloom went back to “${headline(to.summary)}”, but couldn't show it yet.`);
    } catch (problem) {
      setGoBackRefused(goBackProblem(problem, lastBuildId));
    } finally {
      setGoingBack(false);
    }
  };
  const flashState: StepState = flash === null ? (canFlash ? "todo" : "locked") : flash.status === "succeeded" ? flash.verified ? "done" : "warning" : flash.status === "failed" ? (flash.errorCode === "cancelled" ? "todo" : flash.errorCode === "not_confirmed" ? "warning" : "failed") : "active";

  const confirmBlock = (
    <div className="confirm">
      <p className="confirm-title">
        <TriangleAlert size={18} aria-hidden="true" />
        Replace the firmware on your {boardName}?
      </p>
      <p>
        keyloom puts the keyboard in its bootloader itself when it can, and asks you to put it in its bootloader when it can't, then
        writes this build to it. The keyboard stops typing until the flash finishes, so have another keyboard to hand. Your
        layout stays safe in keyloom either way.
      </p>
      <div className="confirm-actions">
        <button type="button" className="button" onClick={() => setConfirming(false)}>Cancel</button>
        <button
          type="button"
          className="button button-primary"
          disabled={starting !== null}
          onClick={() => {
            setConfirming(false);
            release.flashNow();
          }}
        >
          <Zap size={14} aria-hidden="true" />
          Start flashing
        </button>
      </div>
    </div>
  );

  return (
    <dialog
      ref={dialog}
      className="release"
      aria-labelledby="release-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="release-card">
        <header className="release-head">
          <div>
            <h2 id="release-title">Build and flash</h2>
            <p className="muted">
              {earlierRevision ? "From an earlier revision: " : "From the latest layout: "}<strong>{headline(head.summary)}</strong>
            </p>
          </div>
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <p className="sr-only" role="status">{status.label}</p>

        {error === null ? null : (
          <>
            <div className="callout callout-error" role="alert">
              <CircleAlert size={18} aria-hidden="true" />
              <p>{fileGone ? BUILD_FILE_GONE : error}</p>
              {errorWay === "try_again" ? <button type="button" className="button" onClick={release.retry}>Try again</button> : null}
            </div>
            {/* `none`: the step's Build firmware is the way on. */}
            {errorWay === "try_again" || errorWay === "none" ? null : (
              <div className="step-actions">
                {errorWay === "build_again" ? (
                  <button type="button" className="button button-primary" disabled={starting !== null || blocked !== null} onClick={() => release.buildNow(head.id)}>
                    <Hammer size={14} aria-hidden="true" />
                    Build again
                  </button>
                ) : errorWay === "gone" ? (
                  <RestartKeyloom token={token} primary />
                ) : (
                  // Repeating a start or a read that hit a server fault is safe: a flash already running refuses a second one.
                  <UnexpectedWayOut token={token} failure={{ message: error, code: release.errorCode ?? undefined, generic: release.errorGeneric }} onRetry={release.retry} />
                )}
              </div>
            )}
          </>
        )}

        {!earlierRevision || autoSync === null ? null : autoSync.on ? (
          <div className="callout callout-warning" role="alert">
            <TriangleAlert size={18} aria-hidden="true" />
            <p>
              Auto-sync is on, so it puts the latest layout back on your {boardName} soon after this flash. Pause it to keep this revision on the keyboard.
            </p>
            <button type="button" className="button" onClick={autoSync.onPause}>
              <Pause size={14} aria-hidden="true" />
              Pause auto-sync
            </button>
          </div>
        ) : autoSync.paused ? (
          autoSync.onResume === undefined ? (
            <p className="muted" role="status">Auto-sync is paused, so the keyboard keeps this revision. Resume it from the sync menu when you want the latest layout back.</p>
          ) : (
            <p className="release-docker" role="status">
              <span>Auto-sync is paused, so the keyboard keeps this revision.</span>
              <button type="button" className="button" onClick={autoSync.onResume}>
                <Play size={14} aria-hidden="true" />
                Resume auto-sync
              </button>
            </p>
          )
        ) : null}

        <ol className="release-steps">
          <Step number={1} title="Build the firmware" state={buildState} {...(build === null ? {} : { aside: elapsedOf(build, now) })}>
            {build === null ? (
              <>
                {buildStopped ? <p className="muted" role="status">Build stopped.</p> : null}
                <p>
                  {wentBack !== null && earlier
                    ? `The layout is back to “${headline(wentBack)}”. Build it to put it on the keyboard.`
                    : earlier
                    ? "The last build was of an earlier version of this layout. Build again to include the latest change."
                    : "Compiles the layout into firmware. Nothing is sent to your keyboard yet."}
                </p>
                {release.needsBoardRevision ? (
                  <ChoiceGroup
                    legend={`Which ${boardName} is this?`}
                    variant="cards"
                    value={release.boardRevision}
                    choices={revisionChoices(boardRevisions)}
                    onChange={release.chooseBoardRevision}
                  />
                ) : null}
                <DockerCallout view={dockerNow} docker={docker} install={release.dockerInstall} />
                <div className="step-actions">
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={starting !== null || buildOff !== null}
                    {...(buildOff === null ? {} : { "aria-describedby": "build-blocked" })}
                    onClick={() => release.buildNow(head.id)}
                  >
                    {starting === "build" ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <Hammer size={14} aria-hidden="true" />}
                    {starting === "build" ? "Starting" : "Build firmware"}
                  </button>
                  {buildOff === null ? null : <p id="build-blocked" className="blocked-reason">{buildOff}</p>}
                </div>
              </>
            ) : build.status === "running" ? (
              <>
                <p>Building. This runs in Docker and can take a while the first time.</p>
                <Progress label="Building firmware" />
                <LogTail label="Build log" lines={build.logTail} />
                {/* A build never flashes, so stopping it can't reach the keyboard (R3-10). */}
                <div className="step-actions">
                  <button type="button" className="button" disabled={release.stoppingBuild} onClick={release.cancelBuild}>
                    {release.stoppingBuild ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
                    {release.stoppingBuild ? "Stopping" : "Cancel build"}
                  </button>
                  {release.buildCancelProblem === null ? null : <p className="blocked-reason" role="alert">{release.buildCancelProblem}</p>}
                </div>
              </>
            ) : build.status === "succeeded" ? (
              <>
                <p className="ok">Built in {elapsedOf(build, now)}. The firmware is ready to flash.</p>
                <details className="log-details">
                  <summary>Build log</summary>
                  <LogTail label="Build log" lines={build.logTail} />
                </details>
              </>
            ) : (
              <>
                {failure?.kind === "docker" ? (
                  // The build stopped at Docker: the same callout and button as before a build, never the raw sentence.
                  dockerNow.kind === "none" ? <p className="ok">Docker is ready now. Build again to continue.</p> : <DockerCallout view={dockerNow} docker={docker} install={release.dockerInstall} buildFailed />
                ) : failure?.kind === "restart_engine" ? (
                  // The engine's own state stopped it: words and a restart, never the terminal advice in the build's sentence (R6-09).
                  <>
                    <div className="callout callout-error" role="alert">
                      <CircleAlert size={18} aria-hidden="true" />
                      <p>{failure.text}</p>
                    </div>
                    <p>{failure.next}</p>
                    {failure.command === null ? null : <CopyCommand command={failure.command} />}
                    {/* A Mac app or Colima that a failed restart left down: the Docker callout's own button starts it (R7-03). */}
                    {failure.button === null && release.engineRestart.problem !== null && dockerNow.kind !== "none" ? (
                      <DockerCallout view={dockerNow} docker={docker} install={release.dockerInstall} />
                    ) : null}
                    {release.engineRestart.waitingFor === null ? null : (
                      <p className="release-docker" role="status">
                        <LoaderCircle size={14} className="spin" aria-hidden="true" />
                        <span>{restartWaitText(build.restartEngine ?? null, release.engineRestart.waitingFor)}</span>
                      </p>
                    )}
                    {/* The restart's own progress, in the log tail while it runs and after it fails (R7-04). */}
                    {release.engineRestart.log.length > 0 ? (
                      <LogTail label="Restart log" lines={[...release.engineRestart.log]} />
                    ) : (
                      <LogTail label="Build log, last lines" lines={engineRestartLog(build.logTail)} />
                    )}
                  </>
                ) : failure?.kind === "folder_not_shared" || failure?.kind === "disk_full" ? (
                  // The build's sentence names XDG_CACHE_HOME or `docker builder prune`, which stay the CLI's; the page names the folder and
                  // where it is shared (R7-02), or frees the cache itself (R8-04).
                  <>
                    <div className="callout callout-error" role="alert">
                      <CircleAlert size={18} aria-hidden="true" />
                      <p>{failure.text}</p>
                    </div>
                    <p>{failure.next}</p>
                    {failure.kind !== "disk_full" || release.cachePrune.outcome === null ? null : (
                      <p className={release.cachePrune.outcome.again ? "blocked-reason" : "muted"} role="status">{release.cachePrune.outcome.text}</p>
                    )}
                    <LogTail label="Build log, last lines" lines={engineRestartLog(build.logTail)} />
                  </>
                ) : (
                  <>
                    <div className="callout callout-error" role="alert">
                      <CircleAlert size={18} aria-hidden="true" />
                      <p>{plain(build.error ?? "The build failed.")}</p>
                    </div>
                    {failure?.kind === "same_every_time" ? <p>{failure.next}</p> : null}
                    <LogTail label="Build log, last lines" lines={build.logTail} />
                  </>
                )}
                <div className="step-actions">
                  {/* Where the engine shares folders, before Build again, which passes once the folder is shared (R7-02). */}
                  {failure?.kind !== "folder_not_shared" || failure.openApp === null ? null : (
                    <button type="button" className="button button-primary" onClick={() => release.openSettings("docker_desktop")}>
                      <Settings size={14} aria-hidden="true" />
                      Open Docker Desktop
                    </button>
                  )}
                  {failure?.kind !== "folder_not_shared" || failure.helpUrl === null ? null : (
                    <a className="button button-primary" href={failure.helpUrl} target="_blank" rel="noreferrer">
                      <ExternalLink size={14} aria-hidden="true" />
                      Open Colima's guide to mounts
                    </a>
                  )}
                  {/* A layout that doesn't compile or fit fails the same way again, so Build again is only for a failure that may pass (R5-02). */}
                  {failure?.kind === "same_every_time" ? (
                    failure.goBack === null || (goBackRefused !== null && !goBackRefused.retry) ? null : (
                      <button type="button" className="button button-primary" disabled={goingBack} onClick={() => failure.goBack !== null && void goBack(failure.goBack)}>
                        {goingBack ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <Undo2 size={14} aria-hidden="true" />}
                        Go back to the last version that built
                      </button>
                    )
                  ) : failure?.kind === "disk_full" ? (
                    // Freeing the cache comes first, then Build again; once the prune has ended, Build again is the one thing to do. Docker
                    // Desktop's disk limit is in its Settings, which the step opens when that is the way to make room (R9-07).
                    <>
                      {release.cachePrune.outcome?.openApp !== "docker_desktop" ? null : (
                        <button type="button" className="button button-primary" onClick={() => release.openSettings("docker_desktop")}>
                          <Settings size={14} aria-hidden="true" />
                          Open Docker Desktop
                        </button>
                      )}
                      {release.cachePrune.outcome !== null && !release.cachePrune.outcome.again ? null : (
                        <button type="button" className="button button-primary" disabled={release.cachePrune.running || starting !== null} onClick={release.freeCache}>
                          {release.cachePrune.running ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <Eraser size={14} aria-hidden="true" />}
                          {release.cachePrune.running ? "Freeing Docker's build cache…" : "Free Docker's build cache"}
                        </button>
                      )}
                      <button
                        type="button"
                        className={release.cachePrune.outcome !== null && !release.cachePrune.outcome.again && release.cachePrune.outcome.openApp === undefined && release.cachePrune.outcome.failure === undefined ? "button button-primary" : "button"}
                        disabled={starting !== null || blocked !== null || release.cachePrune.running}
                        onClick={() => release.buildNow(head.id)}
                      >
                        Build again
                      </button>
                      {/* A prune request that failed no way the page planned for: Restart keyloom, and the log for an exception (D-540). */}
                      {release.cachePrune.outcome?.failure === undefined ? null : (
                        <UnexpectedWayOut token={token} failure={release.cachePrune.outcome.failure} primary={!release.cachePrune.outcome.again} />
                      )}
                    </>
                  ) : failure?.kind === "restart_engine" && failure.button !== null && release.engineRestart.waitingFor !== null ? (
                    // Waiting for running work to end: the restart starts by itself, and Cancel stops waiting (R7-04).
                    <button type="button" className="button" onClick={release.cancelRestartWait}>
                      <X size={14} aria-hidden="true" />
                      Cancel restart
                    </button>
                  ) : failure?.kind === "restart_engine" && failure.button !== null ? (
                    // Building again hits the same engine state, so the restart comes first and the build follows it.
                    <button type="button" className="button button-primary" disabled={release.engineRestart.running || starting !== null} onClick={() => release.restartAndBuild(head.id, () => shownHead.current)}>
                      {release.engineRestart.running ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
                      {release.engineRestart.running ? failure.busy : failure.button}
                    </button>
                  ) : (
                    <button type="button" className="button" disabled={starting !== null || blocked !== null} onClick={() => release.buildNow(head.id)}>
                      Build again
                    </button>
                  )}
                  {/* A full disk is Docker's, not the layout's: there is nothing in the build for keyloom to explain. */}
                  {failure?.kind === "docker" || failure?.kind === "disk_full" ? null : (
                    <button type="button" className="button" onClick={() => onAskAboutBuild(build)}>
                      <MessageCircle size={14} aria-hidden="true" />
                      Ask keyloom about this build
                    </button>
                  )}
                  {failure?.kind === "restart_engine" && release.engineRestart.problem !== null ? (
                    release.engineRestart.failure === undefined ? <p className="blocked-reason" role="alert">{release.engineRestart.problem}</p> : <FailureNote token={token} failure={release.engineRestart.failure} className="blocked-reason" />
                  ) : null}
                  {(failure?.kind === "folder_not_shared" || failure?.kind === "disk_full") && release.settingsProblem !== null ? <FailureNote token={token} failure={release.settingsProblem} className="blocked-reason" /> : null}
                  {blocked === null || failure?.kind === "same_every_time" ? null : <p className="blocked-reason">{blocked}</p>}
                  {goBackRefused === null ? null : <p className="blocked-reason" role="alert">{goBackRefused.text}</p>}
                  {goBackRefused?.next !== "reload" ? null : (
                    <button type="button" className="button" onClick={() => void showLatest("keyloom couldn't read the latest version yet.")}>
                      <RefreshCw size={14} aria-hidden="true" />
                      Show the latest version
                    </button>
                  )}
                </div>
              </>
            )}
          </Step>

          <Step number={2} title={`Flash ${boardName}`} state={flashState} {...(flash === null ? {} : { aside: elapsedOf(flash, now) })}>
            {/* A file that is gone fails every flash of it, including a Try again on an earlier flash's result (PR #306 CodeRabbit). */}
            {fileGone ? (
              <p className="muted">Available once you build again.</p>
            ) : flash === null ? (
              !canFlash ? (
                <p className="muted">Available once the build succeeds.</p>
              ) : flashPlan?.kind === "manual" ? (
                <ManualFlash view={flashPlan} boardName={boardName} onDownload={release.download} onReveal={release.reveal} onBuildAgain={() => release.buildNow(head.id)} problem={release.fileProblem} />
              ) : flashPlan?.kind === "needs-tool" ? (
                <ToolCallout view={flashPlan} boardName={boardName} install={release.toolInstall} onCheck={release.checkBuild} />
              ) : confirming ? (
                confirmBlock
              ) : (
                <>
                  <p>Writes the build to your keyboard. You will be asked to confirm first.</p>
                  <button type="button" className="button button-primary" onClick={() => setConfirming(true)}>
                    <Zap size={14} aria-hidden="true" />
                    Flash to keyboard
                  </button>
                </>
              )
            ) : flash.status === "waiting_for_bootloader" ? (
              <>
                <div className="instruction" role="alert">
                  <Zap size={24} aria-hidden="true" />
                  <div>
                    <p className="instruction-title">{flash.instruction ?? "Put the keyboard in bootloader mode."}</p>
                    <p className="muted">keyloom is waiting for the keyboard to appear. This continues by itself.</p>
                  </div>
                </div>
                <PermissionFix token={token} code={flash.instructionCode} release={release} />
                <Progress label="Waiting for the bootloader" />
                {/* Offered only before anything is written: once the server says it is writing, Cancel goes (D-501). */}
                {flash.cancellable === true ? (
                  <div className="step-actions">
                    <button type="button" className="button" disabled={release.cancelling} onClick={release.cancelFlash}>
                      {release.cancelling ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
                      {release.cancelling ? "Cancelling" : "Cancel"}
                    </button>
                    <p className="muted">Nothing has been written to the keyboard yet.</p>
                  </div>
                ) : null}
                {release.cancelNote === null ? null : <p className="muted" role="status">{release.cancelNote}</p>}
              </>
            ) : flash.status === "writing" ? (
              <>
                <p><strong>Writing the firmware.</strong> Keep the keyboard plugged in.</p>
                {release.cancelNote === null ? null : <p className="muted" role="status">{release.cancelNote}</p>}
                <Progress label="Writing firmware" />
                <LogTail label="Flash log" lines={flash.logTail} />
              </>
            ) : flash.status === "succeeded" ? (
              <>
                <div className={`callout ${flash.verified ? "callout-success" : "callout-warning"}`} role="status">
                  {flash.verified ? <CircleCheck size={18} aria-hidden="true" /> : <TriangleAlert size={18} aria-hidden="true" />}
                  <p>
                    <strong>{flash.verified ? "Flashed and verified." : "Flashed, not verified."}</strong>{" "}
                    {flash.verified
                      ? <>Your {boardName} is running {earlierRevision ? "this earlier revision" : "the latest layout"}: {withFullStop(headline(head.summary))}</>
                      : flash.checkable === true
                        ? <>keyloom wrote the firmware but couldn't confirm which build your {boardName} runs. Once it has restarted, check it again.</>
                        : <>keyloom wrote the firmware, but it can't read which build your {boardName} runs. Type on it to check the change.</>}
                    {flash.note === null ? null : <> {flash.note}</>}
                  </p>
                </div>
                {flash.verified || flash.checkable !== true ? null : <CheckAgain token={token} release={release} boardName={boardName} onFlashAgain={() => setConfirming(true)} confirming={confirming} confirmBlock={confirmBlock} />}
                <details className="log-details">
                  <summary>Flash log</summary>
                  <LogTail label="Flash log" lines={flash.logTail} />
                </details>
              </>
            ) : flash.errorCode === "cancelled" ? (
              <>
                <div className="callout callout-warning" role="status">
                  <TriangleAlert size={18} aria-hidden="true" />
                  <p>{plain(flash.error ?? "Cancelled. Nothing was written to the keyboard.")}</p>
                </div>
                {confirming ? (
                  confirmBlock
                ) : (
                  <button type="button" className="button button-primary" onClick={() => setConfirming(true)}>
                    <Zap size={14} aria-hidden="true" />
                    Flash to keyboard
                  </button>
                )}
              </>
            ) : (
              <>
                <div className="callout callout-error" role="alert">
                  <CircleAlert size={18} aria-hidden="true" />
                  <FailedText code={flash.errorCode} error={flash.error} />
                </div>
                <PermissionFix token={token} code={flash.errorCode} release={release} />
                <LogTail label="Flash log, last lines" lines={flash.logTail} />
                {/* Written but not confirmed: reading the keyboard comes first, and flashing again stays one click away (D-506). */}
                {flash.checkable === true ? (
                  <CheckAgain token={token} release={release} boardName={boardName} onFlashAgain={() => setConfirming(true)} confirming={confirming} confirmBlock={confirmBlock} flashAlways />
                ) : confirming ? (
                  confirmBlock
                ) : (
                  <button type="button" className="button" onClick={() => setConfirming(true)}>Try again</button>
                )}
              </>
            )}
          </Step>
        </ol>
      </div>
    </dialog>
  );
}

/** Check the keyboard again (R1-15): a read of what the keyboard runs, never a build or a flash, then what it found. */
function FailedText({ code, error }: { code: Flash["errorCode"]; error: string | null }) {
  const text = failedFlashText(code, error);
  return (
    <div className="failed-text">
      <p>{text.lead === null ? null : <><strong>{text.lead}</strong>{" "}</>}{text.detail === null ? null : plain(text.detail)}</p>
      {text.more === undefined ? null : (
        <details className="log-details">
          <summary>Details</summary>
          <span>{plain(text.more)}</span>
        </details>
      )}
    </div>
  );
}

/** `flashAlways` offers Flash again before any check has answered, for a flash that failed after its write. */
function CheckAgain({ token, release, boardName, onFlashAgain, confirming, confirmBlock, flashAlways = false }: { token: string; release: Release; boardName: string; onFlashAgain: () => void; confirming: boolean; confirmBlock: ReactNode; flashAlways?: boolean }) {
  const { check } = release;
  // A check that fails the same way again loses its button; Restart keyloom beside the failure is the way on (R10-07).
  const stuck = failsAgain(check.problem);
  const outcome = check.found === null || check.found === "this_build" ? null : checkOutcome(check.found, boardName);
  const offerFlash = outcome?.next === "flash" || (flashAlways && outcome === null);
  return (
    <>
      {outcome === null ? null : (
        <div className={`callout callout-${outcome.tone}`} role="status">
          {outcome.tone === "success" ? <CircleCheck size={18} aria-hidden="true" /> : <TriangleAlert size={18} aria-hidden="true" />}
          <p>{outcome.text}</p>
        </div>
      )}
      {check.problem === null ? null : (
        <div className="callout callout-error" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <p>{plain(check.problem.message)}</p>
        </div>
      )}
      {check.problem === null || wayOutFor(check.problem, true) === null ? null : (
        <div className="step-actions unexpected-actions">
          <UnexpectedWayOut token={token} failure={check.problem} primary={stuck} />
        </div>
      )}
      {/* A keyboard that has moved on to a later build has nothing left to check or flash here (D-506). */}
      {outcome !== null && outcome.next === null ? null : offerFlash && confirming ? confirmBlock : (
        <div className="step-actions">
          {stuck ? null : (
            <button type="button" className={outcome?.next === "flash" ? "button" : "button button-primary"} disabled={check.running || release.starting !== null} onClick={release.checkKeyboard}>
              {check.running ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
              {check.running ? "Checking" : "Check the keyboard again"}
            </button>
          )}
          {offerFlash ? (
            <button type="button" className={outcome?.next === "flash" ? "button button-primary" : "button"} onClick={onFlashAgain}>
              <Zap size={14} aria-hidden="true" />
              Flash again
            </button>
          ) : null}
        </div>
      )}
    </>
  );
}

// Summaries are often whole sentences from the agent; add a full stop only when one is missing.
function withFullStop(text: string): string {
  return /[.!?]$/.test(text.trim()) ? text : `${text}.`;
}
