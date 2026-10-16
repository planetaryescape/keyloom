import { LoaderCircle, RefreshCw, Undo2, Zap } from "lucide-react";
import { useState } from "react";
import type { RevisionEntry } from "../../api/http.ts";
import { tidySummary, withoutKeyNumbers } from "../../layout/history-summary.ts";
import { SheetHead } from "../shell/Sheet.tsx";
import type { Revisions } from "./useRevisions.ts";
import { formatWhen, sourceLabel } from "./words.ts";
import "./history.css";

interface Props {
  revisions: Revisions;
  onClose: () => void;
  onReload: () => void;
  /** Goes back to this revision as one new revision. Resolves once the page shows it. */
  onGoBack: (revision: RevisionEntry) => Promise<void>;
  onFlash: (revision: RevisionEntry) => void;
  /** Why going back isn't possible right now, shown under the title; null when it is. */
  blockedReason: string | null;
}

// Revisions of this layout, newest first (D-102). Chats are conversations and live in the chat.
export function HistoryPanel({ revisions, onClose, onReload, onGoBack, onFlash, blockedReason }: Props) {
  const [working, setWorking] = useState<string | null>(null);
  const now = Date.now();

  async function goBack(revision: RevisionEntry) {
    setWorking(revision.id);
    try {
      await onGoBack(revision);
    } finally {
      setWorking(null);
    }
  }

  return (
    <section className="history-panel" aria-label="History">
      <SheetHead title="History" lead="Every change to this layout, newest first. Going back is a change too, so nothing is lost." closeLabel="Close the history" onClose={onClose} />
      {blockedReason === null ? null : <p className="sheet-note" role="status">{blockedReason}</p>}
      <div className="sheet-body">
        {revisions.status === "idle" || revisions.status === "loading" ? (
          <p className="sheet-empty" role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" /> Loading the history…</p>
        ) : revisions.status === "error" ? (
          <div className="sheet-empty" role="alert">
            <p>{revisions.message}</p>
            <button type="button" className="sheet-action" onClick={onReload}><RefreshCw size={14} aria-hidden="true" />Try again</button>
          </div>
        ) : (
          <ol className="sheet-rows" aria-label="Revisions">
            {revisions.items.map((revision) => {
              // Older summaries carry key numbers and stacked prefixes; both are read away here (D-279).
              const words = withoutKeyNumbers(revision.origin === "undo" ? tidySummary(revision.summary) : revision.summary);
              return (
                <li key={revision.id} className="sheet-row revision" data-head={revision.isHead} data-origin={revision.origin}>
                  <div className="sheet-row-main">
                    <p className="sheet-row-title">{words}</p>
                    {revision.isHead ? <span className="sheet-pill">On screen</span> : null}
                  </div>
                  <p className="sheet-row-meta">
                    <span>{sourceLabel(revision.origin)}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={new Date(revision.createdAt).toISOString()} title={new Date(revision.createdAt).toLocaleString()}>{formatWhen(revision.createdAt, now)}</time>
                  </p>
                  <div className="sheet-row-actions">
                    {revision.isHead ? null : (
                      <button
                        type="button"
                        className="sheet-action"
                        disabled={blockedReason !== null || working !== null}
                        aria-label={`Go back to: ${words}`}
                        onClick={() => void goBack(revision)}
                      >
                        {working === revision.id ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <Undo2 size={13} aria-hidden="true" />}
                        Go back to this
                      </button>
                    )}
                    <button type="button" className="sheet-action" aria-label={`Put this on the keyboard: ${words}`} onClick={() => onFlash(revision)}>
                      <Zap size={13} aria-hidden="true" />
                      Put this on the keyboard
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
