import { CircleCheck, Circle, ExternalLink, Info, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RemapperSetupResponse } from "../../api/system-remapper.ts";
import { UnexpectedWayOut } from "../shell/UnexpectedWayOut.tsx";
import { type PageFailure, pageFailure, wayOutFor } from "../shell/unexpected.ts";
import type { SyncApi } from "./useSync.ts";
import { CopyCommand } from "../shell/CopyCommand.tsx";
import { type SetupActionId, type SetupFailure, type SetupStep, attentionSteps, recheckAfter, setupFailure, setupSteps } from "./remapper-words.ts";

// A failure keeps its code, so one no screen planned for offers Restart keyloom, never only Check again (R9-05, D-540).
type Load = { kind: "loading" } | { kind: "ready"; status: RemapperSetupResponse } | { kind: "error"; failure: PageFailure };

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
  const [problem, setProblem] = useState<(SetupFailure & { failure?: PageFailure }) | null>(null);
  // A pane was opened for the person to change something there: the list reads the machine again when keyloom's window is back in front.
  const [awaitingReturn, setAwaitingReturn] = useState(false);
  // kanata's last log lines, once Show kanata's log has read them through the password dialog (R11-02). Kept until a restart, which makes
  // them old.
  const [kanataLog, setKanataLog] = useState<string[] | null>(null);
  const { status: readStatus, installKanata, cancelInstall, startKanata, restartKanata, kanataLog: readKanataLog, openSettings } = sync.remapperSetup;

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setLoad({ kind: "ready", status: await readStatus(boardId) });
    } catch (error) {
      setLoad({ kind: "error", failure: pageFailure(error, "keyloom couldn't check kanata.") });
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

  const act = async (id: SetupActionId): Promise<{ ok: true } | { ok: false; code: string; reason: string }> => {
    switch (id.kind) {
      case "install_kanata": return installKanata("install");
      case "update_kanata": return installKanata("upgrade");
      case "reinstall_kanata": return installKanata("reinstall");
      case "cancel_install": return cancelInstall();
      case "start_kanata": return startKanata(boardId);
      case "restart_kanata":
        setKanataLog(null);
        return restartKanata(boardId);
      case "show_kanata_log": {
        const r = await readKanataLog();
        if (r.ok) setKanataLog(r.lines);
        return r.ok ? { ok: true } : r;
      }
      case "open_settings": return openSettings(id.pane);
    }
  };
  const run = async (id: SetupActionId) => {
    setBusy(actionKey(id));
    setProblem(null);
    // Opening a pane changes nothing keyloom can read yet; the change is made there, so the list is read when the person comes back
    // (R8-17). The listener is armed before the pane opens, so a quick return isn't missed (PR #306 CodeRabbit). Everything else is
    // checked again at once.
    const onReturn = recheckAfter(id) === "on_return";
    if (onReturn) setAwaitingReturn(true);
    try {
      const r = await act(id);
      if (!r.ok) setProblem(setupFailure(r.code, r.reason, id.kind));
      if (!r.ok && onReturn) setAwaitingReturn(false);
    } catch (error) {
      const failure = pageFailure(error, "That didn't work.");
      setProblem({ text: failure.message, link: null, failure });
      if (onReturn) setAwaitingReturn(false);
    } finally {
      setBusy(null);
      if (!onReturn) await check();
    }
  };
  useEffect(() => {
    if (!awaitingReturn) return;
    // Focus and visibilitychange both fire on the way back; the first one reads the list, and both listeners go at once.
    const stop = () => {
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
    function back() {
      if (document.visibilityState !== "visible") return;
      stop();
      setAwaitingReturn(false);
      void check();
    }
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return stop;
  }, [awaitingReturn, check]);
  const recheck = (
    <button type="button" className="button sync-setup-recheck" disabled={checking} onClick={() => void check()}>
      <RefreshCw size={14} className={checking ? "spin" : undefined} aria-hidden="true" /> Check again
    </button>
  );

  // A read that failed says so with Check again, in either mode: the attention steps vanishing would hide an update kanata needs (R6-22).
  const readFailed = load.kind !== "error" ? null : (
    <div className="sync-setup">
      <p className="sync-setup-problem" role="alert">{load.failure.message}</p>
      {wayOutFor(load.failure, true) === null ? (
        <button type="button" className="button" disabled={checking} onClick={() => void check()}><RefreshCw size={14} aria-hidden="true" /> Check again</button>
      ) : (
        <span className="sync-setup-actions"><UnexpectedWayOut token={sync.token} failure={load.failure} onRetry={() => void check()} retryDisabled={checking} /></span>
      )}
    </div>
  );
  if (mode === "attention") {
    if (load.kind === "error") return readFailed;
    if (load.kind !== "ready") return null;
    const steps = attentionSteps(load.status);
    if (steps.length === 0) return null;
    return (
      <div className="sync-setup">
        <Steps steps={steps} busy={busy} installing={installing} onRun={run} />
        <ProblemLine problem={problem} token={sync.token} busy={busy !== null} onRun={run} />
        {/* A step done elsewhere (System Settings, Karabiner, Terminal) shows as done once the list is read again (R8-17). */}
        {recheck}
      </div>
    );
  }
  if (load.kind === "loading") {
    return <p className="sync-setup-status"><LoaderCircle size={14} className="spin" aria-hidden="true" /> Checking what kanata needs…</p>;
  }
  if (load.kind === "error") return readFailed;
  return (
    <div className="sync-setup">
      <Steps steps={setupSteps(load.status, { kanataLog })} busy={busy} installing={installing} onRun={run} />
      <ProblemLine problem={problem} token={sync.token} busy={busy !== null} onRun={run} />
      {/* Usable while Homebrew runs: an install finished elsewhere, or a pane allowed meanwhile, shows up at once. */}
      {recheck}
    </div>
  );
}

function Steps({ steps, busy, installing, onRun }: { steps: SetupStep[]; busy: string | null; installing: boolean; onRun: (id: SetupActionId) => void }) {
  // While Homebrew runs, only Cancel and the Settings panes stay pressable: another install or a setup would race it.
  const disabled = (action: SetupStep["actions"][number]) => action.off === true || busy !== null || (installing && action.id.kind !== "cancel_install" && action.id.kind !== "open_settings");
  return (
    <ol className="sync-setup-steps">
      {steps.map((step) => (
        <li key={step.key} className="sync-setup-step" data-state={step.state}>
          {step.state === "done" ? <CircleCheck size={14} aria-hidden="true" /> : step.state === "note" ? <Info size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
          <div className="sync-setup-body">
            <span className="sync-setup-title">{step.title}{step.state === "done" ? <span className="sr-only"> (done)</span> : null}</span>
            {step.detail === null ? null : <span className="sync-setup-detail">{step.detail}</span>}
            {step.copy === null ? null : <CopyCommand command={step.copy.text} noun={step.copy.noun} />}
            {step.log === null || step.log.length === 0 ? null : <LogTail lines={step.log} label={step.logLabel} />}
            {step.problem === null ? null : <span className="sync-setup-problem" role="alert">{step.problem}</span>}
            {step.actions.length === 0 && step.link === null ? null : (
              <span className="sync-setup-actions">
                {step.actions.map((action) => (
                  <button key={actionKey(action.id)} type="button" className="button" disabled={disabled(action)} onClick={() => onRun(action.id)}>
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

/** Homebrew's or kanata's last lines, kept scrolled to the end so the newest is the one in view. */
function LogTail({ lines, label }: { lines: string[]; label: string }) {
  const box = useRef<HTMLPreElement>(null);
  const text = lines.join("\n");
  useLayoutEffect(() => {
    if (box.current !== null) box.current.scrollTop = box.current.scrollHeight;
  }, [text]);
  return <pre ref={box} className="sync-setup-log" aria-label={label}>{text}</pre>;
}

function ProblemLine({ problem, token, busy, onRun }: { problem: (SetupFailure & { failure?: PageFailure }) | null; token: string; busy: boolean; onRun: (id: SetupActionId) => void }) {
  if (problem === null) return null;
  const action = problem.action;
  // The step's own button repeats it; a failure no screen planned for adds Restart keyloom, and the log for an exception (R9-05).
  const unexpected = problem.failure !== undefined && wayOutFor(problem.failure, false) !== null ? problem.failure : null;
  return (
    <>
      <p className="sync-setup-problem" role="alert">
        {problem.text}
        {problem.link === null ? null : (
          <>
            {" "}
            <a href={problem.link.href} target="_blank" rel="noreferrer">{problem.link.label} <ExternalLink size={12} aria-hidden="true" /></a>
          </>
        )}
      </p>
      {/* A failure a step's own button gets past, such as Set up and start kanata after a restart refused (R11-02). */}
      {action === undefined ? null : (
        <span className="sync-setup-actions">
          <button type="button" className="button" disabled={busy} onClick={() => onRun(action.id)}>{action.label}</button>
        </span>
      )}
      {unexpected === null ? null : <span className="sync-setup-actions"><UnexpectedWayOut token={token} failure={unexpected} primary={false} /></span>}
    </>
  );
}
