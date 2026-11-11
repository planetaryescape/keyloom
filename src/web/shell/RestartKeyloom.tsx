import { LoaderCircle, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api.ts";
import { fetchRestartInfo, restartKeyloom } from "./api-restart.ts";
import { CopyCommand } from "./CopyCommand.tsx";
import { RESTARTING_WORDS, RESTART_LABEL, TERMINAL_WORDS, type RestartState, afterRestart } from "./restart-words.ts";

/**
 * Restart keyloom, for a problem only a restart clears (R5-15). In the desktop app it asks the server to stop, and the app starts it again
 * and reloads this page. In a terminal it shows the line to run there, because nothing would start keyloom again.
 */
export function RestartKeyloom({ token, primary = false }: { token: string; primary?: boolean }) {
  const [state, setState] = useState<RestartState>({ kind: "reading" });
  // Read only when a restart is refused, so it lives outside render state.
  const command = useRef("keyloom serve");
  const [reads, setReads] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "reading" });
    fetchRestartInfo(token, controller.signal).then((info) => {
      command.current = info.command;
      setState(info.canRestart ? { kind: "ready" } : { kind: "terminal", command: info.command });
    }, (error: unknown) => {
      if (!controller.signal.aborted) setState({ kind: "unread", message: `keyloom couldn't say how it was started. ${error instanceof Error ? error.message : ""}`.trim() });
    });
    return () => controller.abort();
  }, [token, reads]);

  const restart = () => {
    setState({ kind: "restarting" });
    restartKeyloom(token).then(() => setState(afterRestart(null, command.current)), (error: unknown) => {
      setState(afterRestart(error instanceof ApiError ? { status: error.status, code: error.code, message: error.message } : { message: error instanceof Error ? error.message : "" }, command.current));
    });
  };

  const className = primary ? "button button-primary" : "button";
  switch (state.kind) {
    case "reading":
      return <button type="button" className={className} disabled><LoaderCircle size={14} className="spin" aria-hidden="true" />{RESTART_LABEL}</button>;
    case "unread":
      return (
        <span className="restart-keyloom" role="alert">
          <span>{state.message}</span>
          <button type="button" className="button" onClick={() => setReads((n) => n + 1)}><RefreshCw size={14} aria-hidden="true" />Try again</button>
        </span>
      );
    case "ready":
      return <button type="button" className={className} onClick={restart}><RotateCcw size={14} aria-hidden="true" />{RESTART_LABEL}</button>;
    case "terminal":
      return (
        <span className="restart-keyloom">
          <span>{TERMINAL_WORDS}</span>
          <CopyCommand command={state.command} />
        </span>
      );
    case "restarting":
      return <span className="restart-keyloom" role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" />{RESTARTING_WORDS}</span>;
    case "failed":
      return (
        <span className="restart-keyloom" role="alert">
          <span>{state.message}</span>
          <button type="button" className={className} onClick={restart}><RotateCcw size={14} aria-hidden="true" />{RESTART_LABEL}</button>
        </span>
      );
  }
}
