// Codex is the only provider that answers (it is locked) and its CLI isn't on this computer (R3-24). Where keyloom can, it installs
// the CLI with Homebrew through the same install job as Docker and the flashing tools, shows the output while it runs, and re-reads
// the status when it ends, so the setup moves on to Sign in with Codex. Elsewhere it links the install page and checks again.
import { CircleAlert, Download, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { InstallCancel, InstallStopped } from "../release/InstallCancel.tsx";
import { LogTail } from "../release/LogTail.tsx";
import { useInstall } from "../release/useInstall.ts";

function GetCodex({ page, primary }: { page: string; primary: boolean }) {
  return (
    <a className={primary ? "button button-primary" : "button"} href={page} target="_blank" rel="noreferrer">
      <ExternalLink size={14} aria-hidden="true" />
      Get Codex
    </a>
  );
}

function CheckAgain({ onReload }: { onReload: () => void }) {
  return (
    <button type="button" className="button" onClick={onReload}>
      <RefreshCw size={14} aria-hidden="true" />
      Check again
    </button>
  );
}

export function CodexInstall({ token, text, page, canInstall, onReload }: { token: string; text: string; page: string; canInstall: boolean; onReload: () => void }) {
  const install = useInstall(token, "codex", onReload);
  const state = install.state;
  const problem = install.problem === null ? null : <p className="chat-inline-error" role="alert">{install.problem}</p>;
  if (state?.status === "running") {
    return (
      <div className="setup-install" role="status">
        <p className="setup-waiting">
          <LoaderCircle size={14} className="spin" aria-hidden="true" />
          {state.phase === "stopping" ? "Stopping the install." : "Installing Codex with Homebrew. This takes a minute or two."}
        </p>
        <LogTail label="Install log" lines={state.logTail} />
        <InstallCancel phase={state.phase} onCancel={install.cancel} />
        {problem}
      </div>
    );
  }
  if (state?.status === "failed") {
    return (
      <div className="setup-install">
        <p className="chat-inline-error" role="alert">
          <CircleAlert size={14} aria-hidden="true" /> Codex didn't install. {state.error ?? ""}
        </p>
        {state.logTail.length > 0 ? <LogTail label="Install log, last lines" lines={state.logTail} /> : null}
        <div className="setup-actions">
          <button type="button" className="button button-primary" onClick={install.start}>
            <RefreshCw size={14} aria-hidden="true" />
            Try again
          </button>
          <GetCodex page={page} primary={false} />
          <CheckAgain onReload={onReload} />
        </div>
        {problem}
      </div>
    );
  }
  if (state?.status === "succeeded") {
    // The status re-read on success normally moves the setup on to Sign in; this shows only if keyloom still can't find the CLI.
    return (
      <>
        <p className="muted" role="status">Homebrew installed Codex, but keyloom can't find it yet. Check again in a moment.</p>
        <div className="setup-actions"><CheckAgain onReload={onReload} /><GetCodex page={page} primary={false} /></div>
      </>
    );
  }
  return (
    <>
      <InstallStopped stopped={state?.status === "cancelled"} />
      <p className="muted">{text}</p>
      <div className="setup-actions">
        {canInstall ? (
          <button type="button" className="button button-primary" onClick={install.start}>
            <Download size={14} aria-hidden="true" />
            Install Codex
          </button>
        ) : (
          <GetCodex page={page} primary />
        )}
        <CheckAgain onReload={onReload} />
      </div>
      {problem}
    </>
  );
}
