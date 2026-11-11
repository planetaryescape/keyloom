// What keyloom says about the Docker a build needs, with the button that fixes it (D-486 to D-488). Shared by the
// release dialog and the board review's activity tests, so both offer the same Install or Start.
import { CircleAlert, CircleCheck, Download, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { CopyCommand } from "../shell/CopyCommand.tsx";
import { LogTail } from "./LogTail.tsx";
import type { DockerView } from "./release-words.ts";
import type { Docker } from "./useDocker.ts";
import type { Install } from "./useInstall.ts";

function Alternatives({ items }: { items: Array<{ name: string; url: string }> }) {
  if (items.length === 0) return null;
  return (
    <p className="callout-note">
      Prefer an app?{" "}
      {items.map((item, index) => (
        <span key={item.name}>
          {index > 0 ? " · " : null}
          <a href={item.url} target="_blank" rel="noreferrer">{item.name}</a>
        </span>
      ))}
    </p>
  );
}

export function DockerCallout({ view, docker, install }: { view: DockerView; docker: Docker; install: Install }) {
  const problem = install.problem === null ? null : <p className="callout-note" role="alert">{install.problem}</p>;
  switch (view.kind) {
    case "none":
      return null;
    case "starting":
      return (
        <p className="release-docker" role="status">
          <LoaderCircle size={14} className="spin" aria-hidden="true" />
          <span>Starting {view.engine}. A cold start can take half a minute.</span>
        </p>
      );
    case "start-failed":
      return (
        <div className="callout callout-error" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <div className="callout-body">
            <p>{view.reason}</p>
            <div className="callout-actions">
              <button type="button" className="button" onClick={docker.start}>Try again</button>
              <button type="button" className="button" onClick={docker.refresh}>Check again</button>
            </div>
          </div>
        </div>
      );
    case "install":
      return (
        <div className="callout callout-warning" role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <div className="callout-body">
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
              {view.phase === "starting"
                ? "Docker is installed. Starting it now. The first start downloads a small virtual machine, so it can take a few minutes."
                : "Installing Docker with Homebrew. This can take a few minutes. You can keep editing while it runs."}
            </p>
            <LogTail label="Install log" lines={view.logTail} />
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
              <button type="button" className="button" onClick={docker.refresh}>Check again</button>
            </div>
            {problem}
          </div>
        </div>
      );
    case "installed":
      return (
        <div className="callout callout-success" role="status">
          <CircleCheck size={18} aria-hidden="true" />
          <p>Docker is installed and running. You can build now.</p>
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
    case "no-access":
      return (
        <div className="callout callout-warning" role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <div className="callout-body">
            <p>Docker is running, but it refuses keyloom, so firmware can't build yet.</p>
            {view.command === null ? null : <CopyCommand command={view.command} />}
            <p className="callout-note">{view.note}</p>
            <div className="callout-actions">
              <button type="button" className="button" onClick={docker.refresh}>Check again</button>
            </div>
          </div>
        </div>
      );
    case "down":
      return (
        <p className="release-docker">
          <span>Docker isn't answering. {view.canStart ? `keyloom starts ${view.engine} when you build.` : `Start ${view.engine}, then build.`}</span>
          <button type="button" className="button" onClick={docker.start}>{view.canStart ? "Start it now" : "Start it"}</button>
        </p>
      );
  }
}
