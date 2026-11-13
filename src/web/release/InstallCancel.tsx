// The two pieces every install callout shares (R2-08): Cancel while it runs, and the note after the person stopped one.
import { RefreshCw, X } from "lucide-react";
import type { InstallState } from "../../api/tool-install.ts";
import type { Install } from "./useInstall.ts";
import { retryHelps } from "./UnexpectedActions.tsx";

/** Cancel, hidden once the install is stopping: a second click would only repeat the stop. */
export function InstallCancel({ phase, onCancel }: { phase: InstallState["phase"]; onCancel: () => void }) {
  if (phase === "stopping") return null;
  return (
    <div className="callout-actions">
      <button type="button" className="button" onClick={onCancel}>
        <X size={14} aria-hidden="true" />
        Cancel
      </button>
    </div>
  );
}

export function InstallStopped({ stopped }: { stopped: boolean }) {
  return stopped ? <p className="callout-note">You stopped the install.</p> : null;
}

/**
 * Check again once keyloom lost track of a running install (R10-07). Not for a read that fails the same way every time: Restart keyloom
 * beside the words is the way on then.
 */
export function InstallLost({ install }: { install: Install }) {
  // The read that lost track picks the button, not a failed start or cancel shown before it (PR #315 CodeRabbit).
  const lost = install.lost ?? null;
  if (lost === null || install.checkAgain === undefined || !retryHelps(lost)) return null;
  return (
    <div className="callout-actions">
      <button type="button" className="button" onClick={install.checkAgain}>
        <RefreshCw size={14} aria-hidden="true" />
        Check again
      </button>
    </div>
  );
}
