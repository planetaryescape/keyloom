// The two pieces every install callout shares (R2-08): Cancel while it runs, and the note after the person stopped one.
import { X } from "lucide-react";
import type { InstallState } from "../../api/tool-install.ts";

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
