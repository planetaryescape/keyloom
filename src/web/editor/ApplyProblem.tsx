import { ApiError } from "../api.ts";
import { UnexpectedWayOut } from "../shell/UnexpectedWayOut.tsx";
import { type PageFailure, failsAgain, pageFailure } from "../shell/unexpected.ts";
import { LayoutGoneWayOut, useLayoutGoneWords } from "./LayoutGone.tsx";
import "./editor.css";

/**
 * A pane's Apply that failed (R10-07), kept with its code: Settings, Combos, the tuner and Repeat. A refusal the validator explained is
 * listed in the pane's check box, so the line says only that; anything else keeps the failure, so the pane picks its buttons from the code.
 * A move of the head is not a failure here: each pane reads the newer head first. Pure.
 */
export function applyProblem(error: unknown, listedWords: string): PageFailure {
  if (error instanceof ApiError && error.validation !== undefined) return { message: listedWords };
  return pageFailure(error, "The change could not be applied.");
}

/** The route's own `not_found`: the layout was deleted in another window, so no Apply can land (D-546). */
export const layoutGone = (failure: PageFailure | null): boolean => failure?.code === "not_found" && failure.generic !== true;

/** Apply is its own Try again, except where a second press is sure to fail the same way. Then it goes off, and the line says why. */
export const applyStopped = (failure: PageFailure | null): boolean => failsAgain(failure) || layoutGone(failure);

/**
 * The line under a failed Apply: the sentence, then Restart keyloom and the log for a failure no screen planned for, primary when Apply is
 * off; for a deleted layout, Show your other layouts (R10-09).
 */
export function ApplyProblem({ token, failure, className }: { token: string; failure: PageFailure; className: string }) {
  const goneWords = useLayoutGoneWords();
  const gone = layoutGone(failure);
  return (
    <div className={className} role="alert">
      <p>{gone ? goneWords : failure.message}</p>
      <div className="unexpected-actions">
        {gone ? <LayoutGoneWayOut token={token} /> : <UnexpectedWayOut token={token} failure={failure} primary={failsAgain(failure)} />}
      </div>
    </div>
  );
}
