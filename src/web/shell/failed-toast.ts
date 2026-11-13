// A failed action's toast that keeps the failure's code (R9-05, D-540). Pure: the caller shows the toast and opens the dialog.
import type { ToastInput } from "./Toasts.tsx";
import { type PageFailure, pageFailure, wayOutFor } from "./unexpected.ts";

/** What the toast's Restart keyloom opens: the restart dialog, titled with the toast's words, with Try again only where it can pass. */
export type UnexpectedDialog = { failure: PageFailure; title: string; retry?: () => void };

/**
 * A toast goes after a few seconds, and Restart keyloom has states that must stay on screen, so for a failure no screen planned for the
 * toast's action opens the restart dialog (the direct-edit toast's pattern, D-540). `retry` is the action again; the dialog offers it only
 * for an exception. Any other failure keeps its sentence, and the control that failed stays on the page as its Try again.
 */
export function failedToast(message: string, error: unknown, open: (dialog: UnexpectedDialog) => void, retry?: () => void): ToastInput {
  const failure = pageFailure(error, `${message}.`);
  const way = wayOutFor(failure, retry !== undefined);
  const action = way === null ? {} : { action: { label: "Restart keyloom", run: () => open({ failure, title: message, ...(way.retry && retry !== undefined ? { retry } : {}) }) } };
  return { kind: "error", message, detail: failure.message, ...action };
}
