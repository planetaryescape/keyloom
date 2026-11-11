import { CircleAlert, CircleCheck, Hammer, LoaderCircle, Pause, Play, RefreshCw, Settings, TriangleAlert, X, Zap } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Flash, RevisionInfo } from "../../api/http.ts";
import type { BoardDefinition } from "../../boards/schema.ts";
import { ChoiceGroup } from "../editor/ChoiceGroup.tsx";
import { LogTail } from "./LogTail.tsx";
import { elapsedOf, type ReleaseStatus } from "./status.ts";
import type { Release } from "./useRelease.ts";
import { useDockerRecheck } from "./useDocker.ts";
import { DockerCallout } from "./DockerCallout.tsx";
import { ManualFlash, ToolCallout } from "./FlashPrerequisites.tsx";
import { buildBlockedReason, dockerView, flashStepView, plain, recheckDocker } from "./release-words.ts";
import { headline } from "../../layout/history-summary.ts";
import { checkOutcome, failedFlashText, permissionFix, revisionChoices } from "./flash-words.ts";
import "./release.css";

interface Props {
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
function PermissionFix({ code, release }: { code: Parameters<typeof permissionFix>[0]; release: Release }) {
  const fix = permissionFix(code);
  if (fix === null) return null;
  return (
    <div className="release-docker" role="status">
      <span>{fix.text}</span>
      <button type="button" className="button" onClick={() => release.openSettings(fix.pane)}>
        <Settings size={14} aria-hidden="true" />
        {fix.button}
      </button>
      {release.settingsProblem === null ? null : <span className="blocked-reason" role="alert">{release.settingsProblem}</span>}
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

export function ReleaseDialog({ open, onClose, release, head, earlierRevision = false, autoSync = null, boardName, boardRevisions, status, now }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState(false);
  const { build: lastBuild, flash: lastFlash, starting, error, docker } = release;
  const dockerNow = dockerView(docker.readiness, docker.starting, docker.problem, release.dockerInstall.state);
  const blocked = buildBlockedReason(dockerNow);
  // While Docker is missing, the dialog asks again by itself, so installing it elsewhere needs no click here (D-488).
  useDockerRecheck(docker, open && recheckDocker(dockerNow));

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  // A build of an older revision says nothing about the one on screen, so it is not shown as a result.
  const build = lastBuild !== null && lastBuild.revisionId === head.id ? lastBuild : null;
  const flash = build !== null && lastFlash !== null && lastFlash.buildId === build.id ? lastFlash : null;
  const earlier = lastBuild !== null && build === null;
  const flashing = flash?.status === "waiting_for_bootloader" || flash?.status === "writing";
  const canFlash = build?.status === "succeeded" && !flashing;
  const flashPlan = build === null ? null : flashStepView(build.flashPlan);

  const buildState: StepState = build === null ? "todo" : build.status === "running" ? "active" : build.status === "succeeded" ? "done" : "failed";
  const flashState: StepState = flash === null ? (canFlash ? "todo" : "locked") : flash.status === "succeeded" ? flash.verified ? "done" : "warning" : flash.status === "failed" ? (flash.errorCode === "cancelled" ? "todo" : "failed") : "active";

  const confirmBlock = (
    <div className="confirm">
      <p className="confirm-title">
        <TriangleAlert size={18} aria-hidden="true" />
        Replace the firmware on your {boardName}?
      </p>
      <p>
        keyloom puts the keyboard in its bootloader itself when it can, and asks you to press the reset key when it can't, then
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
          <div className="callout callout-error" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            <p>{error}</p>
            <button type="button" className="button" onClick={release.retry}>Try again</button>
          </div>
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
                <p>
                  {earlier
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
                    disabled={starting !== null || blocked !== null || (release.needsBoardRevision && release.boardRevision === null)}
                    {...(blocked === null ? {} : { "aria-describedby": "build-blocked" })}
                    onClick={() => release.buildNow(head.id)}
                  >
                    {starting === "build" ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <Hammer size={14} aria-hidden="true" />}
                    {starting === "build" ? "Starting" : "Build firmware"}
                  </button>
                  {blocked === null ? null : <p id="build-blocked" className="blocked-reason">{blocked}</p>}
                </div>
              </>
            ) : build.status === "running" ? (
              <>
                <p>Building. This runs in Docker and can take a while the first time.</p>
                <Progress label="Building firmware" />
                <LogTail label="Build log" lines={build.logTail} />
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
                {build.errorCode === "docker_unavailable" ? (
                  // The build stopped at Docker: the same callout and button as before a build, never the raw sentence.
                  dockerNow.kind === "none" ? <p className="ok">Docker is ready now. Build again to continue.</p> : <DockerCallout view={dockerNow} docker={docker} install={release.dockerInstall} />
                ) : (
                  <>
                    <div className="callout callout-error" role="alert">
                      <CircleAlert size={18} aria-hidden="true" />
                      <p>{plain(build.error ?? "The build failed.")}</p>
                    </div>
                    <LogTail label="Build log, last lines" lines={build.logTail} />
                  </>
                )}
                <div className="step-actions">
                  <button type="button" className="button" disabled={starting !== null || blocked !== null} onClick={() => release.buildNow(head.id)}>
                    Build again
                  </button>
                  {blocked === null ? null : <p className="blocked-reason">{blocked}</p>}
                </div>
              </>
            )}
          </Step>

          <Step number={2} title={`Flash ${boardName}`} state={flashState} {...(flash === null ? {} : { aside: elapsedOf(flash, now) })}>
            {flash === null ? (
              !canFlash ? (
                <p className="muted">Available once the build succeeds.</p>
              ) : flashPlan?.kind === "manual" ? (
                <ManualFlash view={flashPlan} boardName={boardName} onDownload={release.download} onReveal={release.reveal} problem={release.fileProblem} />
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
                <PermissionFix code={flash.instructionCode} release={release} />
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
                {flash.verified || flash.checkable !== true ? null : <CheckAgain release={release} boardName={boardName} onFlashAgain={() => setConfirming(true)} confirming={confirming} confirmBlock={confirmBlock} />}
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
                <PermissionFix code={flash.errorCode} release={release} />
                <LogTail label="Flash log, last lines" lines={flash.logTail} />
                {confirming ? (
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
  return <p>{text.lead === null ? null : <><strong>{text.lead}</strong>{" "}</>}{plain(text.detail)}</p>;
}

function CheckAgain({ release, boardName, onFlashAgain, confirming, confirmBlock }: { release: Release; boardName: string; onFlashAgain: () => void; confirming: boolean; confirmBlock: ReactNode }) {
  const { check } = release;
  const outcome = check.found === null || check.found === "this_build" ? null : checkOutcome(check.found, boardName);
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
          <p>{plain(check.problem)}</p>
        </div>
      )}
      {/* A keyboard that has moved on to a later build has nothing left to check or flash here (D-506). */}
      {outcome !== null && outcome.next === null ? null : outcome?.next === "flash" && confirming ? confirmBlock : (
        <div className="step-actions">
          <button type="button" className={outcome?.next === "flash" ? "button" : "button button-primary"} disabled={check.running} onClick={release.checkKeyboard}>
            {check.running ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
            {check.running ? "Checking" : "Check the keyboard again"}
          </button>
          {outcome?.next === "flash" ? (
            <button type="button" className="button button-primary" onClick={onFlashAgain}>
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
