import { FileText, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { ServerLog } from "../../api/server-log.ts";
import { fetchServerLog, showServerLog } from "./api-log.ts";
import { CopyCommand } from "./CopyCommand.tsx";
import { LOG_READ_FAILED_WORDS, SHOW_LOG_LABEL, logReadRetries, logWay } from "./log-words.ts";
import { pageFailure } from "./unexpected.ts";
import { inDesktopApp } from "./server-gone.ts";

/**
 * The way to keyloom's log beside "The details are in keyloom's log." (R8-09): Show keyloom's log where keyloom can open it, the file's
 * path to copy in a browser, or the terminal it runs in. A failed open says why and keeps the path to copy.
 */
export function ShowLog({ token }: { token: string }) {
  const [log, setLog] = useState<ServerLog | null>(null);
  const [showing, setShowing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // A read that can pass on a second try, such as a lost connection, says so with Try again, so the log never goes missing for good.
  const [readFailed, setReadFailed] = useState(false);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setReadFailed(false);
    // An older keyloom has no log route; the page then adds nothing, which is what it showed before.
    fetchServerLog(token, controller.signal).then(setLog, (error: unknown) => {
      if (!controller.signal.aborted && logReadRetries(pageFailure(error, ""))) setReadFailed(true);
    });
    return () => controller.abort();
  }, [token, reads]);

  const way = logWay(log, inDesktopApp());
  if (way === null) {
    return readFailed ? (
      <span className="show-log">
        <span role="alert">{LOG_READ_FAILED_WORDS}</span>
        <button type="button" className="button" onClick={() => setReads((n) => n + 1)}><RefreshCw size={14} aria-hidden="true" />Try again</button>
      </span>
    ) : null;
  }
  const show = () => {
    setShowing(true);
    setProblem(null);
    showServerLog(token).then(() => setShowing(false), (error: unknown) => {
      setShowing(false);
      setProblem(error instanceof Error ? error.message : "keyloom couldn't open its log.");
    });
  };
  const path = way.path ?? (problem !== null && log?.kind === "file" ? log.path : null);
  return (
    <span className="show-log">
      {way.show ? (
        <button type="button" className="button" disabled={showing} onClick={show}>
          {showing ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
          {SHOW_LOG_LABEL}
        </button>
      ) : null}
      {problem === null ? null : <span role="alert">{problem}</span>}
      {way.words === null ? null : <span>{way.words}</span>}
      {path === null ? null : <CopyCommand command={path} />}
    </span>
  );
}
