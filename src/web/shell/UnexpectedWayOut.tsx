import { RefreshCw } from "lucide-react";
import { RestartKeyloom } from "./RestartKeyloom.tsx";
import { unexpectedWayOut } from "./unexpected.ts";

/**
 * The buttons beside a failure no screen planned for (R7-01, R7-09): Try again when the caller passes `onRetry` (repeating is safe there)
 * and the failure can pass on a second try, then Restart keyloom. Renders nothing for any other code, so a screen's own mapping stays.
 */
export function UnexpectedWayOut({ token, code, onRetry, retryDisabled = false, className = "button", primary }: {
  token: string; code: string | undefined; onRetry?: () => void; className?: string;
  /** Try again is off while the screen runs another action, as the screen's own Try again is. */
  retryDisabled?: boolean;
  /** False where the screen's own button is the Try again and already primary, such as the key card's Apply. */
  primary?: boolean;
}) {
  const way = unexpectedWayOut(code, onRetry !== undefined);
  if (way === null) return null;
  return (
    <>
      {way.retry && onRetry !== undefined ? (
        <button type="button" className={className} disabled={retryDisabled} onClick={onRetry}><RefreshCw size={14} aria-hidden="true" />Try again</button>
      ) : null}
      <RestartKeyloom token={token} primary={primary ?? !way.retry} />
    </>
  );
}
