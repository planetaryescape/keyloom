// What keyloom says about the Docker a build needs, with the button that fixes it (D-486 to D-488). Shared by the
// release dialog and the board review's activity tests, so both offer the same Install or Start.
import { AppWindow, CircleAlert, CircleCheck, Download, ExternalLink, LoaderCircle, Play, RefreshCw, RotateCcw, TriangleAlert, Wrench } from "lucide-react";
import { CopyCommand } from "../shell/CopyCommand.tsx";
import { InstallCancel, InstallStopped } from "./InstallCancel.tsx";
import { LogTail } from "./LogTail.tsx";
import type { DockerView } from "./release-words.ts";
import type { Docker } from "./useDocker.ts";
import type { Install } from "./useInstall.ts";

function Alternatives({ items, lead = "Prefer an app?" }: { items: Array<{ name: string; url: string }>; lead?: string }) {
  if (items.length === 0) return null;
  return (
    <p className="callout-note">
      {lead}{" "}
      {items.map((item, index) => (
        <span key={item.name}>
          {index > 0 ? " · " : null}
          <a href={item.url} target="_blank" rel="noreferrer">{item.name}</a>
        </span>
      ))}
    </p>
  );
}

/** Stops and starts an engine from scratch, where starting it again would fail the same way (R3-04). */
function RestartEngine({ engine, docker }: { engine: string; docker: Docker }) {
  return (
    <button type="button" className="button button-primary" onClick={docker.restart}>
      <RotateCcw size={14} aria-hidden="true" />
      Restart {engine}
    </button>
  );
}

/**
 * A Colima on a Mac whose files belong to another account (D-533): Fix Colima's files runs Colima's command through macOS's password
 * dialog. The command stays below as the way to do it by hand, and becomes the way on once the button has failed.
 */
function ColimaNoAccess({ view, fix, docker }: { view: { command: string | null; stopCommand?: string | null }; fix: { offered: boolean; note: string | null }; docker: Docker }) {
  return (
    <div className="callout callout-warning" role="alert">
      <TriangleAlert size={18} aria-hidden="true" />
      <div className="callout-body">
        <p>Docker is running, but it refuses keyloom, so firmware can't build yet.</p>
        {fix.offered ? (
          <p className="callout-note">
            Colima's files belong to another account, usually because Colima was started with sudo. Fix Colima's files gives the files back to
            you and restarts Colima as you. macOS asks for your password first.
          </p>
        ) : null}
        {fix.note === null ? null : <p className="callout-note">{fix.note}</p>}
        {/* Another account's Colima still runs: its stop comes first, then Fix Colima's files (R8-05). */}
        {view.stopCommand == null ? null : (
          <>
            <p className="callout-note">Run this in Terminal to stop that copy of Colima:</p>
            <CopyCommand command={view.stopCommand} />
          </>
        )}
        <div className="callout-actions">
          {fix.offered ? (
            <button type="button" className="button button-primary" onClick={docker.fixFiles}>
              <Wrench size={14} aria-hidden="true" />
              Fix Colima's files
            </button>
          ) : null}
          <button type="button" className="button" onClick={docker.refresh}>Check again</button>
        </div>
        {view.command === null ? null : (
          <>
            <p className="callout-note">{fix.offered ? "Or run Colima's command in Terminal yourself, then check again:" : "Run this in Terminal to fix Colima's files yourself, then check again:"}</p>
            <CopyCommand command={view.command} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * `buildFailed`: a build just stopped at Docker, after it had tried to start the engine itself when it may (D-486). `readyNext` is what
 * the person can do once Docker installed from here is running, said where they are.
 */
export function DockerCallout({ view, docker, install, buildFailed = false, readyNext = "You can build now." }: { view: DockerView; docker: Docker; install: Install; buildFailed?: boolean; readyNext?: string }) {
  const problem = install.problem === null ? null : <p className="callout-note" role="alert">{install.problem}</p>;
  switch (view.kind) {
    case "none":
      return null;
    case "starting":
      return (
        <p className="release-docker" role="status">
          <LoaderCircle size={14} className="spin" aria-hidden="true" />
          <span>{view.verb} {view.engine}. {view.verb === "Opening" ? "Finish its setup if it asks you to." : "A cold start can take half a minute."}</span>
        </p>
      );
    case "fixing-files":
      return (
        <div className="callout callout-info" role="status">
          <LoaderCircle size={18} className="spin" aria-hidden="true" />
          <div className="callout-body">
            <p>Fixing Colima's files. macOS asks for your password first, then keyloom starts Colima as you, which can take half a minute.</p>
          </div>
        </div>
      );
    case "start-failed":
      return (
        <div className="callout callout-error" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <div className="callout-body">
            <p>{view.reason}</p>
            {view.helpUrl === null ? null : <p className="callout-note">Restarting didn't help either. Colima's guide covers a virtual machine that won't start.</p>}
            <div className="callout-actions">
              {view.restartEngine === null ? null : <RestartEngine engine={view.restartEngine} docker={docker} />}
              {view.retry === null ? null : <button type="button" className="button" onClick={view.retry === "restart" ? docker.restart : docker.start}>Try again</button>}
              {view.helpUrl === null ? null : (
                <a className="button" href={view.helpUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} aria-hidden="true" />
                  Open Colima's guide
                </a>
              )}
              {/* Another engine is the other way on when Colima won't come back (R4-04b), as after a failed install. */}
              {view.alternatives?.[0] === undefined ? null : (
                <a className="button" href={view.alternatives[0].url} target="_blank" rel="noreferrer">
                  <Download size={14} aria-hidden="true" />
                  Download {view.alternatives[0].name}
                </a>
              )}
              <button type="button" className="button" onClick={docker.refresh}>Check again</button>
            </div>
            {view.alternatives === undefined ? null : <Alternatives items={view.alternatives.slice(1)} lead="Or install" />}
          </div>
        </div>
      );
    case "install":
      return (
        <div className="callout callout-warning" role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <div className="callout-body">
            <InstallStopped stopped={view.stopped} />
            <p>Firmware is built in Docker, and this computer doesn't have it. keyloom can install {view.engine} for you with Homebrew. It needs no password and takes a few minutes.</p>
            {view.note === "" ? null : <p className="callout-note">{view.note}</p>}
            <div className="callout-actions">
              <button type="button" className="button button-primary" onClick={install.start}>
                <Download size={14} aria-hidden="true" />
                Install Docker
              </button>
              <button type="button" className="button" onClick={docker.refresh}>Check again</button>
            </div>
            <Alternatives items={view.alternatives} />
            {problem}
          </div>
        </div>
      );
    case "download":
      return (
        <div className="callout callout-warning" role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <div className="callout-body">
            <p>Firmware is built in Docker, and this computer doesn't have it. Install {view.engine}. keyloom notices it by itself once it is running.</p>
            {view.note === "" ? null : <p className="callout-note">{view.note}</p>}
            <div className="callout-actions">
              <a className="button button-primary" href={view.url} target="_blank" rel="noreferrer">
                <Download size={14} aria-hidden="true" />
                Download {view.engine}
              </a>
              <button type="button" className="button" onClick={docker.refresh}>Check again</button>
            </div>
            <Alternatives items={view.alternatives} />
          </div>
        </div>
      );
    case "installing":
      return (
        <div className="callout callout-info" role="status">
          <LoaderCircle size={18} className="spin" aria-hidden="true" />
          <div className="callout-body">
            <p>
              {view.phase === "stopping"
                ? "Stopping the install."
                : view.phase === "starting"
                  ? "Docker is installed. Starting it now. The first start downloads a small virtual machine, so it can take a few minutes."
                  : "Installing Docker with Homebrew. This can take a few minutes. You can keep editing while it runs."}
            </p>
            <LogTail label="Install log" lines={view.logTail} />
            <InstallCancel phase={view.phase} onCancel={install.cancel} />
            {problem}
          </div>
        </div>
      );
    case "install-failed":
      return (
        <div className="callout callout-error" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <div className="callout-body">
            <p>Docker didn't install. {view.reason}</p>
            {view.logTail.length > 0 ? <LogTail label="Install log, last lines" lines={view.logTail} /> : null}
            <div className="callout-actions">
              <button type="button" className="button" onClick={install.start}>
                <RefreshCw size={14} aria-hidden="true" />
                Try again
              </button>
              {view.alternatives[0] === undefined ? null : (
                <a className="button" href={view.alternatives[0].url} target="_blank" rel="noreferrer">
                  <Download size={14} aria-hidden="true" />
                  Download {view.alternatives[0].name}
                </a>
              )}
              <button type="button" className="button" onClick={docker.refresh}>Check again</button>
            </div>
            <Alternatives items={view.alternatives.slice(1)} lead="Or install" />
            {problem}
          </div>
        </div>
      );
    case "installed":
      return (
        <div className="callout callout-success" role="status">
          <CircleCheck size={18} aria-hidden="true" />
          <p>Docker is installed and running. {readyNext}</p>
        </div>
      );
    case "other":
      return (
        <div className="callout callout-warning" role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <div className="callout-body">
            <p>{view.reason}</p>
            <div className="callout-actions">
              <button type="button" className="button" onClick={docker.refresh}>Check again</button>
            </div>
          </div>
        </div>
      );
    case "cli-missing":
      return (
        <div className="callout callout-warning" role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <div className="callout-body">
            <p>{view.app} is installed, but its docker command isn't set up yet, so firmware can't build. Opening {view.app} sets it up.</p>
            <div className="callout-actions">
              <button type="button" className="button button-primary" onClick={docker.start}>
                <AppWindow size={14} aria-hidden="true" />
                Open {view.app}
              </button>
              <button type="button" className="button" onClick={docker.refresh}>Check again</button>
            </div>
          </div>
        </div>
      );
    case "no-access":
      if (view.fix !== null) return <ColimaNoAccess view={view} fix={view.fix} docker={docker} />;
      return (
        <div className="callout callout-warning" role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <div className="callout-body">
            <p>Docker is running, but it refuses keyloom, so firmware can't build yet.</p>
            {view.command === null ? null : <CopyCommand command={view.command} />}
            <p className="callout-note">{view.restartApp === null ? view.note : `Restarting ${view.restartApp} gives keyloom access again.`}</p>
            <div className="callout-actions">
              {view.restartApp === null ? null : (
                <button type="button" className="button button-primary" onClick={docker.restart}>
                  <RotateCcw size={14} aria-hidden="true" />
                  Restart {view.restartApp}
                </button>
              )}
              <button type="button" className="button" onClick={docker.refresh}>Check again</button>
            </div>
          </div>
        </div>
      );
    case "down":
      if (view.afterInstall !== null) {
        return (
          <div className="callout callout-warning" role="alert">
            <TriangleAlert size={18} aria-hidden="true" />
            <div className="callout-body">
              <p>
                {view.afterInstall.cancelled
                  ? `Docker is installed. You stopped ${view.engine} before it started.`
                  : `Docker is installed, but ${view.engine} didn't start. ${view.afterInstall.reason}`}
              </p>
              <div className="callout-actions">
                {/* A first start that failed fails the same way again, so a Colima gets a restart from scratch instead (R3-04). */}
                {view.restartEngine !== null && !view.afterInstall.cancelled ? (
                  <RestartEngine engine={view.restartEngine} docker={docker} />
                ) : (
                  <button type="button" className="button button-primary" onClick={docker.start}>
                    <Play size={14} aria-hidden="true" />
                    Start it now
                  </button>
                )}
                <button type="button" className="button" onClick={docker.refresh}>Check again</button>
              </div>
            </div>
          </div>
        );
      }
      // The build already started this engine and it didn't come up, so starting it once more would fail the same way (R3-04).
      if (buildFailed && view.canStart && view.restartEngine !== null) {
        return (
          <div className="callout callout-warning" role="alert">
            <TriangleAlert size={18} aria-hidden="true" />
            <div className="callout-body">
              <p>{view.engine} didn't start, so the build stopped before it began. Restarting {view.restartEngine} from scratch usually fixes this.</p>
              <div className="callout-actions">
                <RestartEngine engine={view.restartEngine} docker={docker} />
                <button type="button" className="button" onClick={docker.refresh}>Check again</button>
              </div>
            </div>
          </div>
        );
      }
      return (
        <p className="release-docker">
          <span>Docker isn't answering. {view.canStart ? `keyloom starts ${view.engine} when you build.` : `Start ${view.engine}, then build.`}</span>
          <button type="button" className="button" onClick={docker.start}>{view.canStart ? "Start it now" : "Start it"}</button>
        </p>
      );
  }
}
