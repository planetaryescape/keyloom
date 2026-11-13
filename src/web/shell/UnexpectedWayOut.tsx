import { RefreshCw } from "lucide-react";
import { RestartKeyloom } from "./RestartKeyloom.tsx";
import { ShowLog } from "./ShowLog.tsx";
import { type PageFailure, unexpectedWayOut, wayOutFor } from "./unexpected.ts";

/**
 * The buttons beside a failure no screen planned for (R7-01, R7-09): Try again when the caller passes `onRetry` (repeating is safe there)
 * and the failure can pass on a second try, then Restart keyloom, and for an exception the way to keyloom's log (R8-09). Renders nothing
 * for any other code, so a screen's own mapping stays.
 *
 * Pass `failure` (from `pageFailure`) where the screen kept the whole failure: a route's own `not_found` then keeps the screen's buttons
 * (R8-03). `code` alone treats every `not_found` as unexpected.
 */
export function UnexpectedWayOut({ token, code, failure, onRetry, retryDisabled = false, className = "button", primary }: {
  token: string; code?: string | undefined; failure?: PageFailure; onRetry?: () => void; className?: string;
  /** Try again is off while the screen runs another action, as the screen's own Try again is. */
  retryDisabled?: boolean;
  /** False where the screen's own button is the Try again and already primary, such as the key card's Apply. */
  primary?: boolean;
}) {
  const way = failure === undefined ? unexpectedWayOut(code, onRetry !== undefined) : wayOutFor(failure, onRetry !== undefined);
  if (way === null) return null;
  return (
    <>
      {way.retry && onRetry !== undefined ? (
        <button type="button" className={className} disabled={retryDisabled} onClick={onRetry}><RefreshCw size={14} aria-hidden="true" />Try again</button>
      ) : null}
      <RestartKeyloom token={token} primary={primary ?? !way.retry} />
      {/* "The details are in keyloom's log." gets a way to read it (R8-09). Only an exception's words name the log. */}
      {code === "internal" || failure?.code === "internal" ? <ShowLog token={token} /> : null}
    </>
  );
}

/**
 * The way on under a failed read that a screen can ask for again (R8-03): Try again for a failure that can pass on a second try, such as
 * a lost connection; Try again and Restart keyloom for an exception; Restart keyloom alone for an answer that fails the same way every
 * time. Use it in place of a bare Try again.
 */
export function RetryOrRestart({ token, failure, onRetry, className = "button" }: { token: string; failure: PageFailure; onRetry: () => void; className?: string }) {
  if (wayOutFor(failure, true) !== null) return <UnexpectedWayOut token={token} failure={failure} onRetry={onRetry} className={className} />;
  return <button type="button" className={className} onClick={onRetry}><RefreshCw size={14} aria-hidden="true" />Try again</button>;
}
