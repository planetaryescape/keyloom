// The flash step when a Flash button would fail: the tool it runs is missing (D-489), or keyloom can't flash this
// board at all, so the person gets the file and the board's own steps instead (D-490).
import { CircleAlert, Download, FolderOpen, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { LogTail } from "./LogTail.tsx";
import { type FlashStepView, plain } from "./release-words.ts";
import type { Install } from "./useInstall.ts";

type NeedsTool = Extract<FlashStepView, { kind: "needs-tool" }>;
type Manual = Extract<FlashStepView, { kind: "manual" }>;

export function ToolCallout({ view, boardName, install, onCheck }: { view: NeedsTool; boardName: string; install: Install; onCheck: () => void }) {
  const state = install.state;
  const problem = install.problem === null ? null : <p className="callout-note" role="alert">{install.problem}</p>;
  if (state?.status === "running") {
    return (
      <div className="callout callout-info" role="status">
        <LoaderCircle size={18} className="spin" aria-hidden="true" />
        <div className="callout-body">
          <p>Installing {view.name} with Homebrew. This takes a minute or two.</p>
          <LogTail label="Install log" lines={state.logTail} />
          {problem}
        </div>
      </div>
    );
  }
  if (state?.status === "failed") {
    return (
      <div className="callout callout-error" role="alert">
        <CircleAlert size={18} aria-hidden="true" />
        <div className="callout-body">
          <p>{view.name} didn't install. {plain(state.error ?? "")}</p>
          {state.logTail.length > 0 ? <LogTail label="Install log, last lines" lines={state.logTail} /> : null}
          <div className="callout-actions">
            <button type="button" className="button" onClick={install.start}>
              <RefreshCw size={14} aria-hidden="true" />
              Try again
            </button>
            <button type="button" className="button" onClick={onCheck}>Check again</button>
          </div>
          {problem}
        </div>
      </div>
    );
  }
  return (
    <div className="callout callout-warning" role="alert">
      <TriangleAlert size={18} aria-hidden="true" />
      <div className="callout-body">
        <p>
          keyloom flashes your {boardName} with {view.name}, and this computer doesn't have it yet.
          {view.canInstall ? ` keyloom can install it with Homebrew.` : ` Install it, then check again.`}
        </p>
        <div className="callout-actions">
          {view.canInstall ? (
            <button type="button" className="button button-primary" onClick={install.start}>
              <Download size={14} aria-hidden="true" />
              Install {view.name}
            </button>
          ) : (
            <a className="button button-primary" href={view.url} target="_blank" rel="noreferrer">
              <Download size={14} aria-hidden="true" />
              Get {view.name}
            </a>
          )}
          <button type="button" className="button" onClick={onCheck}>Check again</button>
        </div>
        {problem}
      </div>
    </div>
  );
}

export function ManualFlash({ view, boardName, onDownload, onReveal, problem }: { view: Manual; boardName: string; onDownload: () => void; onReveal: () => void; problem: string | null }) {
  return (
    <>
      <p>keyloom can't put firmware on the {boardName} by itself. Save the file, then follow the board's steps:</p>
      <p><strong>{view.instructions}</strong></p>
      <div className="step-actions">
        <button type="button" className="button button-primary" onClick={onDownload}>
          <Download size={14} aria-hidden="true" />
          Download firmware
        </button>
        {view.canReveal ? (
          <button type="button" className="button" onClick={onReveal}>
            <FolderOpen size={14} aria-hidden="true" />
            Show in Finder
          </button>
        ) : null}
      </div>
      {problem === null ? null : (
        <div className="callout callout-error" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <p>{problem}</p>
        </div>
      )}
    </>
  );
}
