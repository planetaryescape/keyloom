import { CircleAlert } from "lucide-react";
import { useEffect, useRef } from "react";
import { UnexpectedWayOut } from "./UnexpectedWayOut.tsx";
import type { PageFailure } from "./unexpected.ts";

/**
 * A failure no screen planned for, opened from a toast's Restart keyloom (R8-03). A toast goes after a few seconds, and Restart keyloom
 * has states that must stay on screen (the line to run in a terminal, the wait while it restarts), so they live here. Try again repeats
 * the change only where the failure can pass on a second try.
 */
export function RestartDialog({ token, title, failure, onRetry, onClose }: { token: string; title: string; failure: PageFailure; onRetry?: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
  }, []);
  return (
    <dialog ref={dialog} className="layer-dialog restart-dialog" aria-labelledby="restart-dialog-title" onClose={onClose} onClick={(event) => event.target === event.currentTarget && onClose()}>
      <h2 id="restart-dialog-title" className="drop-title">{title}</h2>
      <p className="layer-dialog-lead" data-tone="error">
        <CircleAlert size={16} aria-hidden="true" />
        <span>{failure.message}</span>
      </p>
      <footer className="layer-dialog-foot">
        <button type="button" className="button" onClick={onClose}>Close</button>
        <UnexpectedWayOut token={token} failure={failure} {...(onRetry === undefined ? {} : { onRetry: () => { onClose(); onRetry(); } })} />
      </footer>
    </dialog>
  );
}
