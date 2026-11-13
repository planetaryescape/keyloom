import { LoaderCircle, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api.ts";
import { fetchRestartInfo, restartKeyloom } from "./api-restart.ts";
import { CopyCommand } from "./CopyCommand.tsx";
import { RESTARTING_WORDS, RESTART_LABEL, RESTART_SLOW_AFTER_MS, SLOW_RESTART_WORDS, TERMINAL_WORDS, type RestartState, afterInfoFailure, afterRestart, afterWaiting, mismatchWords } from "./restart-words.ts";
import { inDesktopApp } from "./server-gone.ts";

// Not an ApiError only when an OK answer's body couldn't be read, which afterRestart counts as a restart.
const answerOf = (error: unknown) => (error instanceof ApiError
  ? { status: error.status, code: error.code, generic: error.generic, message: error.message }
  : { message: error instanceof Error ? error.message : "" });

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
      if (!controller.signal.aborted) setState(afterInfoFailure(answerOf(error)));
    });
    return () => controller.abort();
  }, [token, reads]);

  // A restart that never comes back would otherwise say "comes back by itself" for ever. After the wait, a server that still answers on this
  // link never restarted, so the button comes back; one that doesn't gets the words for what to do.
  useEffect(() => {
    if (state.kind !== "restarting") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchRestartInfo(token, controller.signal).then(() => setState(afterWaiting(true)), () => {
        if (!controller.signal.aborted) setState(afterWaiting(false));
      });
    }, RESTART_SLOW_AFTER_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [state.kind, token]);

  const restart = () => {
    setState({ kind: "restarting" });
    restartKeyloom(token).then(() => setState(afterRestart(null, command.current)), (error: unknown) => {
      setState(afterRestart(answerOf(error), command.current));
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
    case "slow":
      return <span className="restart-keyloom" role="status">{SLOW_RESTART_WORDS}</span>;
    case "mismatch": {
      // No Try again: this keyloom answers the same way until it is restarted by hand (R8-19).
      const words = mismatchWords(state.older, inDesktopApp());
      return (
        <span className="restart-keyloom" role="alert">
          <span>{words.text}</span>
          {words.command === null ? null : <CopyCommand command={words.command} />}
        </span>
      );
    }
    case "failed":
      return (
        <span className="restart-keyloom" role="alert">
          <span>{state.message}</span>
          <button type="button" className={className} onClick={restart}><RotateCcw size={14} aria-hidden="true" />{RESTART_LABEL}</button>
        </span>
      );
  }
}
