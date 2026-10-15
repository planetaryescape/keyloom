import { CircleAlert, CircleCheck, Hammer, LoaderCircle, TriangleAlert, X, Zap } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { RevisionInfo } from "../../api/http.ts";
import { LogTail } from "./LogTail.tsx";
import { elapsedOf, type ReleaseStatus } from "./status.ts";
import type { Release } from "./useRelease.ts";
import "./release.css";

interface Props {
  open: boolean;
  onClose: () => void;
  release: Release;
  /** The revision a build would be made from. */
  head: RevisionInfo;
  boardName: string;
  status: ReleaseStatus;
  now: number;
}

type StepState = "todo" | "active" | "done" | "failed" | "locked";

function Step({ number, title, state, aside, children }: { number: number; title: string; state: StepState; aside?: string; children: ReactNode }) {
  return (
    <li className="step" data-state={state}>
      <span className="step-mark" aria-hidden="true">
        {state === "done" ? <CircleCheck size={20} /> : state === "failed" ? <CircleAlert size={20} /> : number}
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

function Progress({ label }: { label: string }) {
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-busy="true">
      <span />
    </div>
  );
}

export function ReleaseDialog({ open, onClose, release, head, boardName, status, now }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState(false);
  const { build: lastBuild, flash: lastFlash, starting, error } = release;

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

  const buildState: StepState = build === null ? "todo" : build.status === "running" ? "active" : build.status === "succeeded" ? "done" : "failed";
  const flashState: StepState = flash === null ? (canFlash ? "todo" : "locked") : flash.status === "succeeded" ? "done" : flash.status === "failed" ? "failed" : "active";

  const confirmBlock = (
    <div className="confirm">
      <p className="confirm-title">
        <TriangleAlert size={18} aria-hidden="true" />
        Replace the firmware on your {boardName}?
      </p>
      <p>
        keyloom will ask you to put the keyboard in its bootloader, then write this build to it. The keyboard stops typing
        until the flash finishes, so have another keyboard to hand. Your layout stays safe in keyloom either way.
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
              From the latest layout: <strong>{head.summary}</strong>
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <p className="sr-only" role="status">{status.label}</p>

        {error === null ? null : (
          <div className="callout callout-error" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            <p>{error}</p>
            <button type="button" className="button" onClick={release.resume}>Try again</button>
          </div>
        )}

        <ol className="steps">
          <Step number={1} title="Build the firmware" state={buildState} {...(build === null ? {} : { aside: elapsedOf(build, now) })}>
            {build === null ? (
              <>
                <p>
                  {earlier
                    ? "The last build was of an earlier version of this layout. Build again to include the latest change."
                    : "Compiles the layout into firmware. Nothing is sent to your keyboard yet."}
                </p>
                <button type="button" className="button button-primary" disabled={starting !== null} onClick={() => release.buildNow(head.id)}>
                  {starting === "build" ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <Hammer size={14} aria-hidden="true" />}
                  {starting === "build" ? "Starting" : "Build firmware"}
                </button>
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
                <div className="callout callout-error" role="alert">
                  <CircleAlert size={18} aria-hidden="true" />
                  <p>{build.error ?? "The build failed."}</p>
                </div>
                <LogTail label="Build log, last lines" lines={build.logTail} />
                <button type="button" className="button" disabled={starting !== null} onClick={() => release.buildNow(head.id)}>
                  Build again
                </button>
              </>
            )}
          </Step>

          <Step number={2} title={`Flash ${boardName}`} state={flashState} {...(flash === null ? {} : { aside: elapsedOf(flash, now) })}>
            {flash === null ? (
              !canFlash ? (
                <p className="muted">Available once the build succeeds.</p>
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
                <Progress label="Waiting for the bootloader" />
              </>
            ) : flash.status === "writing" ? (
              <>
                <p><strong>Writing the firmware.</strong> Keep the keyboard plugged in.</p>
                <Progress label="Writing firmware" />
                <LogTail label="Flash log" lines={flash.logTail} />
              </>
            ) : flash.status === "succeeded" ? (
              <>
                <div className="callout callout-success" role="status">
                  <CircleCheck size={18} aria-hidden="true" />
                  <p>
                    <strong>Flashed.</strong> Your {boardName} restarts with the latest layout: {head.summary}.
                  </p>
                </div>
                <details className="log-details">
                  <summary>Flash log</summary>
                  <LogTail label="Flash log" lines={flash.logTail} />
                </details>
              </>
            ) : (
              <>
                <div className="callout callout-error" role="alert">
                  <CircleAlert size={18} aria-hidden="true" />
                  <p>{flash.error ?? "Flashing failed."}</p>
                </div>
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
