import { FileText, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { ServerLog } from "../../api/server-log.ts";
import { fetchServerLog, showServerLog } from "./api-log.ts";
import { CopyCommand } from "./CopyCommand.tsx";
import { SHOW_LOG_LABEL, logWay } from "./log-words.ts";
import { inDesktopApp } from "./server-gone.ts";

/**
 * The way to keyloom's log beside "The details are in keyloom's log." (R8-09): Show keyloom's log where keyloom can open it, the file's
 * path to copy in a browser, or the terminal it runs in. A failed open says why and keeps the path to copy.
 */
export function ShowLog({ token }: { token: string }) {
  const [log, setLog] = useState<ServerLog | null>(null);
  const [showing, setShowing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    // An older keyloom has no log route; the page then adds nothing, which is what it showed before.
    fetchServerLog(token, controller.signal).then(setLog, () => {});
    return () => controller.abort();
  }, [token]);

  const way = logWay(log, inDesktopApp());
  if (way === null) return null;
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
