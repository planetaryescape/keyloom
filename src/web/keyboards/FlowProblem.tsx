import { FailureNote } from "../shell/UnexpectedWayOut.tsx";
import type { NewKeyboard } from "./useNewKeyboard.ts";

/**
 * A failed Add, Start blank or Make in the new-keyboard steps (R9-05): the sentence, then Restart keyloom and the log for a failure no
 * screen planned for (D-540). The step's own button stays its Try again, unless the failure fails the same way every time (`flow.stuck`).
 */
export function FlowProblem({ flow }: { flow: Pick<NewKeyboard, "problem" | "token"> }) {
  if (flow.problem === null) return null;
  return <FailureNote token={flow.token} failure={flow.problem} className="nb-problem" />;
}
