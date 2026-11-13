import { LayoutGrid, RefreshCw } from "lucide-react";
import { useContext, type ReactNode } from "react";
import { OtherLayoutsContext } from "../editor/LayoutGone.tsx";
import { RestartKeyloom } from "../shell/RestartKeyloom.tsx";
import { RetryOrRestart } from "../shell/UnexpectedWayOut.tsx";
import type { PageFailure } from "../shell/unexpected.ts";
import { proposalsReadWay, proposalsReadWords } from "./proposals-read.ts";

/**
 * A failed read of a config's open proposals (R11-05), in the proposals panel and the board review: the screen's sentence, then the way on
 * that can work. A config deleted elsewhere offers the layouts keyloom has; a read that fails the same way offers Restart keyloom alone;
 * any other read offers Try again (and Restart keyloom for an exception).
 */
export function ProposalsReadProblem({ token, failure, lead, onReadAgain, className }: {
  token: string | undefined; failure: PageFailure; lead: string; onReadAgain: (() => void) | undefined; className: string;
}) {
  const showOthers = useContext(OtherLayoutsContext);
  const way = proposalsReadWay(failure);
  let action: ReactNode = null;
  if (way === "gone") {
    // Outside a layout page nothing else lists the layouts, so a restart opens the page on what keyloom has.
    action = showOthers !== null
      ? <button type="button" className="button button-primary" onClick={showOthers}><LayoutGrid size={14} aria-hidden="true" />Show your other layouts</button>
      : token === undefined ? null : <RestartKeyloom token={token} primary />;
  } else if (token !== undefined && onReadAgain !== undefined) {
    action = <RetryOrRestart token={token} failure={failure} onRetry={onReadAgain} className="sheet-action" />;
  } else if (token !== undefined) {
    action = way === "restart" ? <RestartKeyloom token={token} primary /> : null;
  } else if (way === "retry" && onReadAgain !== undefined) {
    action = <button type="button" className="sheet-action" onClick={onReadAgain}><RefreshCw size={13} aria-hidden="true" />Try again</button>;
  }
  return (
    <div className={className} role="alert">
      <p>{proposalsReadWords(failure, lead)}</p>
      {action === null ? null : <div className="unexpected-actions">{action}</div>}
    </div>
  );
}
