import { RefreshCw } from "lucide-react";
import type { NewKeyboard } from "./useNewKeyboard.ts";
import "./keyboards.css";

/** A QMK and ZMK search that failed says so, with Search again (R6-19). */
export function SearchFailed({ flow }: { flow: Pick<NewKeyboard, "searchProblem" | "retrySearch"> }) {
  return (
    <div className="nb-problem" role="alert">
      <p>keyloom couldn't search QMK and ZMK. {flow.searchProblem}</p>
      <p className="nb-actions"><button type="button" className="sheet-action" onClick={flow.retrySearch}><RefreshCw size={13} aria-hidden="true" />Search again</button></p>
    </div>
  );
}
