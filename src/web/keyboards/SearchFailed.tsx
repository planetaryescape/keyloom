import { RetryOrRestart } from "../shell/UnexpectedWayOut.tsx";
import type { NewKeyboard } from "./useNewKeyboard.ts";
import "./keyboards.css";

/**
 * A QMK and ZMK search that failed says so, with Search again (R6-19). A failure that fails the same way every time offers Restart
 * keyloom in its place, and an exception both, with the log (R10-07).
 */
export function SearchFailed({ flow }: { flow: Pick<NewKeyboard, "searchProblem" | "retrySearch" | "token"> }) {
  if (flow.searchProblem === null) return null;
  return (
    <div className="nb-problem" role="alert">
      <p>keyloom couldn't search QMK and ZMK. {flow.searchProblem.message}</p>
      <p className="nb-actions"><RetryOrRestart token={flow.token} failure={flow.searchProblem} onRetry={flow.retrySearch} className="sheet-action" retryLabel="Search again" /></p>
    </div>
  );
}
