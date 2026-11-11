import { CircleCheck, Circle, ExternalLink, Info, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { RemapperSetupResponse } from "../../api/system-remapper.ts";
import type { SyncApi } from "./useSync.ts";
import { type SetupActionId, setupFailure, setupSteps } from "./remapper-words.ts";

type Load = { kind: "loading" } | { kind: "ready"; status: RemapperSetupResponse } | { kind: "error"; message: string };

const actionKey = (id: SetupActionId) => (id.kind === "open_settings" ? `pane:${id.pane}` : id.kind);

/**
 * What kanata still needs, read from the doctor, with a button for each step (D-493). Each finished step reads the machine again, so
 * the list follows what is true; the pill says kanata is running only when the sync engine sees it answer.
 */
export function RemapperSetup({ sync, boardId }: { sync: SyncApi; boardId: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { status: readStatus, installKanata, startKanata, openSettings } = sync.remapperSetup;

  const check = useCallback(async () => {
    try {
      setLoad({ kind: "ready", status: await readStatus(boardId) });
    } catch (error) {
      setLoad({ kind: "error", message: error instanceof Error ? error.message : "keyloom couldn't check kanata." });
    }
    // readStatus is rebuilt each render from the same token; boardId is what changes the answer.
  }, [boardId]);
  useEffect(() => {
    void check();
  }, [check]);
  // An install started earlier (the popover was closed meanwhile) is followed until it ends.
  const installing = load.kind === "ready" && load.status.installing;
  useEffect(() => {
    if (!installing) return;
    const timer = window.setInterval(() => void check(), 3000);
    return () => window.clearInterval(timer);
  }, [installing, check]);

  const run = async (id: SetupActionId) => {
    setBusy(actionKey(id));
    setProblem(null);
    try {
      const r = id.kind === "install_kanata" ? await installKanata() : id.kind === "start_kanata" ? await startKanata(boardId) : await openSettings(id.pane);
      if (!r.ok) setProblem(setupFailure(r.code, r.reason));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That didn't work.");
    } finally {
      setBusy(null);
      // Opening a pane changes nothing keyloom can read; everything else is checked again at once.
      if (id.kind !== "open_settings") await check();
    }
  };

  if (load.kind === "loading") {
    return <p className="sync-setup-status"><LoaderCircle size={14} className="spin" aria-hidden="true" /> Checking what kanata needs…</p>;
  }
  if (load.kind === "error") {
    return (
      <div className="sync-setup">
        <p className="sync-setup-problem" role="alert">{load.message}</p>
        <button type="button" className="button" onClick={() => void check()}><RefreshCw size={14} aria-hidden="true" /> Check again</button>
      </div>
    );
  }
  const steps = setupSteps(load.status);
  return (
    <div className="sync-setup">
      <ol className="sync-setup-steps">
        {steps.map((step) => (
          <li key={step.key} className="sync-setup-step" data-state={step.state}>
            {step.state === "done" ? <CircleCheck size={14} aria-hidden="true" /> : step.state === "note" ? <Info size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
            <div className="sync-setup-body">
              <span className="sync-setup-title">{step.title}{step.state === "done" ? <span className="sr-only"> (done)</span> : null}</span>
              {step.detail === null ? null : <span className="sync-setup-detail">{step.detail}</span>}
              {step.actions.length === 0 && step.link === null ? null : (
                <span className="sync-setup-actions">
                  {step.actions.map((action) => (
                    <button key={actionKey(action.id)} type="button" className="button" disabled={busy !== null} onClick={() => void run(action.id)}>
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
      {problem === null ? null : <p className="sync-setup-problem" role="alert">{problem}</p>}
      <button type="button" className="button sync-setup-recheck" disabled={busy !== null} onClick={() => void check()}>
        <RefreshCw size={14} aria-hidden="true" /> Check again
      </button>
    </div>
  );
}
