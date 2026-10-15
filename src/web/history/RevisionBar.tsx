import { History, LoaderCircle, Redo2, Undo2 } from "lucide-react";
import type { RevisionInfo } from "../../api/http.ts";

import "./revision.css";

const ORIGIN: Record<RevisionInfo["origin"], string> = {
  import: "Imported",
  editor: "Edited",
  agent: "Agent",
  undo: "",
};

interface Props {
  revision: RevisionInfo;
  busy: boolean;
  /** Why undo is unavailable right now, shown as the button's tooltip. */
  blockedReason: string | null;
  onUndo: () => void;
}

// The head revision in one line, with the way back. An undo is itself a revision, so undoing it
// puts the change back: the button says Redo then, so the label matches what pressing it does.
export function RevisionBar({ revision, busy, blockedReason, onUndo }: Props) {
  const redo = revision.origin === "undo";
  const Icon = redo ? Redo2 : Undo2;
  const origin = ORIGIN[revision.origin];
  return (
    <div className="revision-bar">
      <History size={16} aria-hidden="true" />
      <p className="revision-text" title={revision.summary}>
        <span className="revision-label">Latest</span>
        {origin === "" ? null : <span className="revision-origin">{origin}</span>}
        <span className="revision-summary">{revision.summary}</span>
      </p>
      {revision.undoable ? (
        <button
          type="button"
          className="button"
          disabled={busy || blockedReason !== null}
          title={blockedReason ?? (redo ? "Put the undone change back" : "Go back to the layout before this change")}
          onClick={onUndo}
        >
          {busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <Icon size={14} aria-hidden="true" />}
          {redo ? "Redo" : "Undo"}
        </button>
      ) : null}
    </div>
  );
}
