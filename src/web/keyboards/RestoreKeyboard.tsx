import { LoaderCircle, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CollectionKeyboard } from "../../api/keyboards.ts";
import { ApiError } from "../api.ts";
import { UnexpectedWayOut } from "../shell/UnexpectedWayOut.tsx";
import { type PageFailure, failsAgain, pageFailure } from "../shell/unexpected.ts";
import "./keyboards.css";

/** A config refused because its keyboard was removed (R6-08): the page offers Restore, not the server's sentence. */
export const keyboardRemoved = (error: unknown): boolean => error instanceof ApiError && error.code === "keyboard_removed";

/** What a refusal for a removed keyboard says (R6-08): why, and that Restore does the refused thing again. */
export const removedWords = (boardName: string, doing: string): string =>
  `You removed the ${boardName} from keyloom, so it takes no new configs. Restore it to ${doing}. Its syncing stays paused until you resume it.`;

/**
 * Restores the keyboard, then does the refused thing again, unless the refusal is no longer on screen: a file chosen while the restore
 * ran replaced it, and the old import must not run after it (#299 review). Resolves to why the restore failed, kept whole so its code
 * picks the buttons (R10-07), or null.
 */
export async function restoreThenRetry(restore: () => Promise<unknown>, onRestored: () => void | Promise<void>, current: () => boolean): Promise<PageFailure | null> {
  try {
    await restore();
  } catch (error) {
    return pageFailure(error, "That didn't work.");
  }
  if (current()) await onRestored();
  return null;
}

/**
 * A config refused because its keyboard was removed (R6-08): Restore {board}, the same restore as Your keyboards' Restore button, then
 * `onRestored` does the refused import or new config again. A failed restore says so and keeps the button, unless it would fail the same
 * way again: then Restart keyloom beside the sentence is the way on (R10-07).
 */
export function RestoreKeyboard({ token, restore: restoreIt, boardName, doing, onRestored }: {
  /** For Restart keyloom beside a failure no screen planned for. Without it the sentence shows alone and Restore stays. */
  token?: string | undefined;
  /** The restore call, `restoreKeyboard` from api-keyboards.ts for the board. */
  restore: () => Promise<CollectionKeyboard>;
  boardName: string;
  /** What Restore goes on to do, after "Restore it to": "import this layout", "make this config". */
  doing: string;
  onRestored: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<PageFailure | null>(null);
  const off = token !== undefined && failsAgain(failed);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const restore = async () => {
    setBusy(true);
    setFailed(null);
    const failure = await restoreThenRetry(restoreIt, onRestored, () => mounted.current);
    if (!mounted.current) return;
    setBusy(false);
    setFailed(failure);
  };
  return (
    <div className="nb-problem nb-cant" role="alert">
      <p>{removedWords(boardName, doing)}</p>
      {failed === null ? null : <p className="nb-restore-failed">keyloom couldn't restore the {boardName}. {failed.message}</p>}
      <p className="nb-actions">
        <button type="button" className="sheet-action" disabled={busy || off} onClick={() => void restore()}>
          {busy ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <RotateCcw size={13} aria-hidden="true" />}
          Restore {boardName}
        </button>
        {token === undefined || failed === null ? null : <UnexpectedWayOut token={token} failure={failed} primary={off} className="sheet-action" />}
      </p>
    </div>
  );
}
