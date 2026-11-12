import { LoaderCircle, RotateCcw } from "lucide-react";
import { useState } from "react";
import type { CollectionKeyboard } from "../../api/keyboards.ts";
import { ApiError } from "../api.ts";
import "./keyboards.css";

/** A config refused because its keyboard was removed (R6-08): the page offers Restore, not the server's sentence. */
export const keyboardRemoved = (error: unknown): boolean => error instanceof ApiError && error.code === "keyboard_removed";

/** What a refusal for a removed keyboard says (R6-08): why, and that Restore does the refused thing again. */
export const removedWords = (boardName: string, doing: string): string =>
  `You removed the ${boardName} from keyloom, so it takes no new configs. Restore it to ${doing}. Its syncing stays paused until you resume it.`;

/**
 * A config refused because its keyboard was removed (R6-08): Restore {board}, the same restore as Your keyboards' Restore button, then
 * `onRestored` does the refused import or new config again. A failed restore says so and keeps the button.
 */
export function RestoreKeyboard({ restore: restoreIt, boardName, doing, onRestored }: {
  /** The restore call, `restoreKeyboard` from api-keyboards.ts for the board. */
  restore: () => Promise<CollectionKeyboard>;
  boardName: string;
  /** What Restore goes on to do, after "Restore it to": "import this layout", "make this config". */
  doing: string;
  onRestored: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const restore = async () => {
    setBusy(true);
    setFailed(null);
    try {
      await restoreIt();
    } catch (error) {
      setFailed(error instanceof Error ? error.message : "keyloom couldn't restore it.");
      setBusy(false);
      return;
    }
    setBusy(false);
    await onRestored();
  };
  return (
    <div className="nb-problem nb-cant" role="alert">
      <p>{removedWords(boardName, doing)}</p>
      {failed === null ? null : <p className="nb-restore-failed">keyloom couldn't restore the {boardName}. {failed}</p>}
      <p className="nb-actions">
        <button type="button" className="sheet-action" disabled={busy} onClick={() => void restore()}>
          {busy ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <RotateCcw size={13} aria-hidden="true" />}
          Restore {boardName}
        </button>
      </p>
    </div>
  );
}
