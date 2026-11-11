// The release dialog's Cancel (D-501, D-506), apart from React so its race can be tested: an answer that comes back after another
// flash has replaced the cancelled one on screen is dropped, or it would put the old, finished flash back over the new one and take
// away its progress and its own Cancel.
import type { Flash } from "../../api/http.ts";
import { ApiError } from "../api.ts";
import { cancelNote } from "./flash-words.ts";

export type CancelShownFlashDeps = {
  cancel: (id: string) => Promise<Flash>;
  /** Reads the flash as it is now, after a refused cancel. */
  read: (id: string) => Promise<Flash>;
  /** The id of the flash on screen now. */
  shown: () => string | undefined;
  setFlash: (flash: Flash) => void;
  setNote: (note: string | null) => void;
};

/** Cancels flash `id` and shows the answer while that flash is still the one on screen. */
export async function cancelShownFlash(id: string, deps: CancelShownFlashDeps): Promise<void> {
  const stillShown = () => deps.shown() === id;
  try {
    const next = await deps.cancel(id);
    if (!stillShown()) return;
    deps.setFlash(next);
    deps.setNote(cancelNote({ status: next.status }));
  } catch (e: unknown) {
    if (!stillShown()) return;
    // Refused because the write began, or it already ended: the note says why, the flash as it is now says where it is, and Cancel goes away.
    deps.setNote(e instanceof ApiError && e.code !== undefined ? cancelNote({ refused: e.code }) : null);
    const now = await deps.read(id).catch(() => undefined);
    if (now !== undefined && stillShown()) deps.setFlash(now);
  }
}
