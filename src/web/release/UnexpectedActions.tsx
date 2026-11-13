// Restart keyloom, and the log for an exception, under a Docker or install request that failed no way the page planned for (R9-05, D-540).
// The callout's own button stays the Try again, so this adds no second one.
import { UnexpectedWayOut } from "../shell/UnexpectedWayOut.tsx";
import { type PageFailure, wayOutFor } from "../shell/unexpected.ts";

/** Whether the callout's own Try again can pass on a second press; false only for a failure that fails the same way every time. */
export const retryHelps = (failure: PageFailure | null | undefined): boolean => failure == null || wayOutFor(failure, true)?.retry !== false;

export function UnexpectedActions({ token, failure }: { token: string | undefined; failure: PageFailure | null | undefined }) {
  if (token === undefined || failure == null || wayOutFor(failure, false) === null) return null;
  return (
    <div className="callout-actions">
      <UnexpectedWayOut token={token} failure={failure} primary={false} />
    </div>
  );
}
