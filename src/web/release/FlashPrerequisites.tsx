// The flash step when a Flash button would fail: the tool it runs is missing (D-489), or keyloom can't flash this
// board at all, so the person gets the file and the board's own steps instead (D-490).
import { CircleAlert, Download, ExternalLink, FolderOpen, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { InstallCancel, InstallLost, InstallStopped } from "./InstallCancel.tsx";
import { LogTail } from "./LogTail.tsx";
import type { FileProblem } from "./flash-words.ts";
import type { FlashStepView } from "./release-words.ts";
import { toolFailed, toolMissingLead, toolPageLabel, toolRunning, toolWay } from "./tool-words.ts";
import type { Install } from "./useInstall.ts";
import { UnexpectedActions } from "./UnexpectedActions.tsx";

type NeedsTool = Extract<FlashStepView, { kind: "needs-tool" }>;
type Manual = Extract<FlashStepView, { kind: "manual" }>;

export function ToolCallout({ view, boardName, install, onCheck }: { view: NeedsTool; boardName: string; install: Install; onCheck: () => void }) {
  const state = install.state;
  const problem = install.problem === null ? null : (
    <>
      <p className="callout-note" role="alert">{install.problem}</p>
      <UnexpectedActions token={install.token} failure={install.failure} />
    </>
  );
  if (state?.status === "running") {
    return (
      <div className="callout callout-info" role="status">
        <LoaderCircle size={18} className="spin" aria-hidden="true" />
        <div className="callout-body">
          <p>{toolRunning(view, state)}</p>
          <LogTail label="Install log" lines={state.logTail} />
          <InstallCancel phase={state.phase} onCancel={install.cancel} />
          {problem}
          <InstallLost install={install} />
        </div>
      </div>
    );
  }
  if (state?.status === "failed") {
    return (
      <div className="callout callout-error" role="alert">
        <CircleAlert size={18} aria-hidden="true" />
        <div className="callout-body">
          <p>{toolFailed(view, state)}</p>
          {state.logTail.length > 0 ? <LogTail label="Install log, last lines" lines={state.logTail} /> : null}
          <div className="callout-actions">
            <button type="button" className="button" onClick={install.start}>
              <RefreshCw size={14} aria-hidden="true" />
              Try again
            </button>
            <a className="button" href={view.url} target="_blank" rel="noreferrer">
              <ExternalLink size={14} aria-hidden="true" />
              {toolPageLabel(view)}
            </a>
            <button type="button" className="button" onClick={onCheck}>Check again</button>
          </div>
          {problem}
        </div>
      </div>
    );
  }
  const way = toolWay(view);
  return (
    <div className="callout callout-warning" role="alert">
      <TriangleAlert size={18} aria-hidden="true" />
      <div className="callout-body">
        <InstallStopped stopped={state?.status === "cancelled"} />
        <p>{toolMissingLead(view, boardName)}</p>
        <div className="callout-actions">
          {way !== "page" ? (
            <button type="button" className="button button-primary" onClick={install.start}>
              <Download size={14} aria-hidden="true" />
              {way === "brew" ? "Install" : "Get"} {view.name}
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

export function ManualFlash({ view, boardName, onDownload, onReveal, onBuildAgain, problem }: {
  view: Manual; boardName: string; onDownload: () => void; onReveal: () => void; onBuildAgain: () => void; problem: FileProblem | null;
}) {
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
          <div className="callout-body">
            <p>{problem.text}</p>
            {/* The file was cleaned up: a new build of the same version makes it again, and a download can't (D-534). */}
            {problem.gone ? (
              <div className="callout-actions">
                <button type="button" className="button" onClick={onBuildAgain}>
                  <RefreshCw size={14} aria-hidden="true" />
                  Build again
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
