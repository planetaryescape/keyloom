import type { ChangeOutcome } from "../editor/useChange.ts";
import { UnexpectedWayOut } from "../shell/UnexpectedWayOut.tsx";
import { failsAgain } from "../shell/unexpected.ts";

type Refused = Extract<ChangeOutcome, { ok: false }>;

/**
 * Why a layer's Delete waits, beside it (R11-06): the last Delete got an answer that fails the same way every time (keyloom's catch-all,
 * an answer this page can't read), so pressing it again can't help and Restart keyloom beside the refusal is the way on. Null otherwise.
 */
export const deleteWaits = (refused: Refused | null): string | null =>
  refused !== null && failsAgain(refused.failure) ? "Deleting it again would fail the same way. Restart keyloom first." : null;

/**
 * A layer change keyloom refused or couldn't make, where it was asked for (R11-06): the sentence, the validator's reasons, and for a failure
 * no screen planned for, Restart keyloom and the way to keyloom's log beside "The details are in keyloom's log.". `primary`: the control
 * that sent it went off (`deleteWaits`), so Restart keyloom leads.
 */
export function LayerRefusal({ token, refused, problems, primary = false }: { token: string | undefined; refused: Refused; problems: number; primary?: boolean }) {
  return (
    <div className="layer-refused" role="alert">
      <strong>{refused.message}</strong>
      {refused.problems.length === 0 ? null : (
        <ul>
          {refused.problems.slice(0, problems).map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      )}
      {token === undefined || refused.failure === undefined ? null : (
        <div className="unexpected-actions"><UnexpectedWayOut token={token} failure={refused.failure} primary={primary} /></div>
      )}
    </div>
  );
}
