// The toast for a read of the layout that failed after a change was written or refused (R5-08, R6-03, R10-07). Pure: the caller shows it.
import type { ToastInput } from "../shell/Toasts.tsx";
import type { UnexpectedDialog } from "../shell/failed-toast.ts";
import { pageFailure, wayOutFor } from "../shell/unexpected.ts";

/**
 * A failure a second read can pass (a lost connection) keeps the button that reads again (`label`, `again`). One that fails the same way
 * every time, an unreadable answer or keyloom's catch-all, gets Restart keyloom, which opens the restart dialog, never a button that reads
 * again for ever. An exception's dialog offers the read again too. `lead` goes before the failure's own sentence.
 */
export function rereadToast({ message, lead, error, label, again, open }: {
  message: string; lead?: string; error: unknown; label: string; again: () => void; open: (dialog: UnexpectedDialog) => void;
}): ToastInput {
  const failure = pageFailure(error, "");
  const detail = [lead ?? "", failure.message.trim()].filter(Boolean).join(" ");
  const way = wayOutFor(failure, true);
  const action = way === null
    ? { label, run: again }
    : { label: "Restart keyloom", run: () => open({ failure, title: message, ...(way.retry ? { retry: again } : {}) }) };
  return { kind: "error", message, ...(detail === "" ? {} : { detail }), action };
}
