// The toast for a read of the layout that failed after a change was written or refused (R5-08, R6-03, R10-07). Pure: the caller shows it.
import type { ToastInput } from "../shell/Toasts.tsx";
import type { UnexpectedDialog } from "../shell/failed-toast.ts";
import { pageFailure, wayOutFor } from "../shell/unexpected.ts";

/** The layout itself is gone (the route's own `not_found`), so reading it again can't work. */
export const LAYOUT_GONE_REREAD = "keyloom no longer has this layout. It may have been deleted in another window.";

/**
 * A failure a second read can pass (a lost connection) keeps the button that reads again (`label`, `again`). One that fails the same way
 * every time, an unreadable answer or keyloom's catch-all, gets Restart keyloom, which opens the restart dialog, never a button that reads
 * again for ever. An exception's dialog offers the read again too. A layout deleted elsewhere offers `showOthers`, the page's Show your
 * other layouts, or Restart keyloom without it (PR #313 review). `lead` goes before the failure's own sentence.
 */
export function rereadToast({ message, lead, error, label, again, open, showOthers }: {
  message: string; lead?: string; error: unknown; label: string; again: () => void; open: (dialog: UnexpectedDialog) => void; showOthers?: (() => void) | undefined;
}): ToastInput {
  const failure = pageFailure(error, "");
  if (failure.code === "not_found" && failure.generic !== true) {
    const action = showOthers !== undefined
      ? { label: "Show your other layouts", run: showOthers }
      : { label: "Restart keyloom", run: () => open({ failure: { message: LAYOUT_GONE_REREAD }, title: message }) };
    return { kind: "error", message, detail: LAYOUT_GONE_REREAD, action };
  }
  const detail = [lead ?? "", failure.message.trim()].filter(Boolean).join(" ");
  const way = wayOutFor(failure, true);
  const action = way === null
    ? { label, run: again }
    : { label: "Restart keyloom", run: () => open({ failure, title: message, ...(way.retry ? { retry: again } : {}) }) };
  return { kind: "error", message, ...(detail === "" ? {} : { detail }), action };
}
