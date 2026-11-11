import { CircleCheck, Circle, ExternalLink, Info, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RemapperSetupResponse } from "../../api/system-remapper.ts";
import type { SyncApi } from "./useSync.ts";
import { type SetupActionId, type SetupStep, attentionSteps, setupFailure, setupSteps } from "./remapper-words.ts";

type Load = { kind: "loading" } | { kind: "ready"; status: RemapperSetupResponse } | { kind: "error"; message: string };
type Problem = ReturnType<typeof setupFailure>;

const actionKey = (id: SetupActionId) => (id.kind === "open_settings" ? `pane:${id.pane}` : id.kind);
// Often enough that Homebrew's lines read as progress, not so often that a long install floods the server.
const INSTALL_POLL_MS = 1500;

/**
 * What kanata still needs, read from the doctor, with a button for each step (D-493). Each finished step reads the machine again, so
 * the list follows what is true; the pill says kanata is running only when the sync engine sees it answer.
 *
 * `setup` is the whole checklist, while kanata isn't running. `attention` is for a running kanata: only the steps that still need doing
 * (an update, or setting up again after one), and nothing at all when there are none.
 */
export function RemapperSetup({ sync, boardId, mode = "setup" }: { sync: SyncApi; boardId: string; mode?: "setup" | "attention" }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const { status: readStatus, installKanata, cancelInstall, startKanata, openSettings } = sync.remapperSetup;

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setLoad({ kind: "ready", status: await readStatus(boardId) });
    } catch (error) {
      setLoad({ kind: "error", message: error instanceof Error ? error.message : "keyloom couldn't check kanata." });
    } finally {
      setChecking(false);
    }
    // readStatus is rebuilt each render from the same token; boardId is what changes the answer.
  }, [boardId]);
  useEffect(() => {
    void check();
  }, [check]);
  // An install runs on the server: the list follows it, with Homebrew's last lines, until it ends. One started earlier (the popover was
  // closed meanwhile) is followed the same way.
  const installing = load.kind === "ready" && load.status.install.state === "running";
  useEffect(() => {
    if (!installing) return;
    const timer = window.setInterval(() => void check(), INSTALL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [installing, check]);

  const act = (id: SetupActionId) => {
    switch (id.kind) {
      case "install_kanata": return installKanata("install");
      case "update_kanata": return installKanata("upgrade");
      case "cancel_install": return cancelInstall();
      case "start_kanata": return startKanata(boardId);
      case "open_settings": return openSettings(id.pane);
    }
  };
  const run = async (id: SetupActionId) => {
    setBusy(actionKey(id));
    setProblem(null);
    try {
      const r = await act(id);
      if (!r.ok) setProblem(setupFailure(r.code, r.reason));
    } catch (error) {
      setProblem({ text: error instanceof Error ? error.message : "That didn't work.", link: null });
    } finally {
      setBusy(null);
      // Opening a pane changes nothing keyloom can read; everything else is checked again at once.
      if (id.kind !== "open_settings") await check();
    }
  };

  if (mode === "attention") {
    if (load.kind !== "ready") return null;
    const steps = attentionSteps(load.status);
    if (steps.length === 0) return null;
    return (
      <div className="sync-setup">
        <Steps steps={steps} busy={busy} installing={installing} onRun={run} />
        <ProblemLine problem={problem} />
      </div>
    );
  }
  if (load.kind === "loading") {
    return <p className="sync-setup-status"><LoaderCircle size={14} className="spin" aria-hidden="true" /> Checking what kanata needs…</p>;
  }
  if (load.kind === "error") {
    return (
      <div className="sync-setup">
        <p className="sync-setup-problem" role="alert">{load.message}</p>
        <button type="button" className="button" disabled={checking} onClick={() => void check()}><RefreshCw size={14} aria-hidden="true" /> Check again</button>
      </div>
    );
  }
  return (
    <div className="sync-setup">
      <Steps steps={setupSteps(load.status)} busy={busy} installing={installing} onRun={run} />
      <ProblemLine problem={problem} />
      {/* Usable while Homebrew runs: an install finished elsewhere, or a pane allowed meanwhile, shows up at once. */}
      <button type="button" className="button sync-setup-recheck" disabled={checking} onClick={() => void check()}>
        <RefreshCw size={14} className={checking ? "spin" : undefined} aria-hidden="true" /> Check again
      </button>
    </div>
  );
}

function Steps({ steps, busy, installing, onRun }: { steps: SetupStep[]; busy: string | null; installing: boolean; onRun: (id: SetupActionId) => void }) {
  // While Homebrew runs, only Cancel and the Settings panes stay pressable: another install or a setup would race it.
  const disabled = (id: SetupActionId) => busy !== null || (installing && id.kind !== "cancel_install" && id.kind !== "open_settings");
  return (
    <ol className="sync-setup-steps">
      {steps.map((step) => (
        <li key={step.key} className="sync-setup-step" data-state={step.state}>
          {step.state === "done" ? <CircleCheck size={14} aria-hidden="true" /> : step.state === "note" ? <Info size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
          <div className="sync-setup-body">
            <span className="sync-setup-title">{step.title}{step.state === "done" ? <span className="sr-only"> (done)</span> : null}</span>
            {step.detail === null ? null : <span className="sync-setup-detail">{step.detail}</span>}
            {step.log === null || step.log.length === 0 ? null : <LogTail lines={step.log} />}
            {step.problem === null ? null : <span className="sync-setup-problem" role="alert">{step.problem}</span>}
            {step.actions.length === 0 && step.link === null ? null : (
              <span className="sync-setup-actions">
                {step.actions.map((action) => (
                  <button key={actionKey(action.id)} type="button" className="button" disabled={disabled(action.id)} onClick={() => onRun(action.id)}>
                    {busy === actionKey(action.id) ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
                    {action.label}
                  </button>
                ))}
                {step.link === null ? null : (
                  <a className="button" href={step.link.href} target="_blank" rel="noreferrer">
                    {step.link.label} <ExternalLink size={12} aria-hidden="true" />
                  </a>
                )}
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Homebrew's last lines, kept scrolled to the end so the newest is the one in view. */
function LogTail({ lines }: { lines: string[] }) {
  const box = useRef<HTMLPreElement>(null);
  const text = lines.join("\n");
  useLayoutEffect(() => {
    if (box.current !== null) box.current.scrollTop = box.current.scrollHeight;
  }, [text]);
  return <pre ref={box} className="sync-setup-log" aria-label="What Homebrew printed last">{text}</pre>;
}

function ProblemLine({ problem }: { problem: Problem | null }) {
  if (problem === null) return null;
  return (
    <p className="sync-setup-problem" role="alert">
      {problem.text}
      {problem.link === null ? null : (
        <>
          {" "}
          <a href={problem.link.href} target="_blank" rel="noreferrer">{problem.link.label} <ExternalLink size={12} aria-hidden="true" /></a>
        </>
      )}
    </p>
  );
}
