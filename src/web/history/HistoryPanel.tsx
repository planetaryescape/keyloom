import { History, LoaderCircle, RefreshCw, Undo2, X, Zap } from "lucide-react";
import { useState } from "react";
import type { RevisionEntry } from "../../api/http.ts";
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
      <header className="panel-head">
        <span className="history-icon" aria-hidden="true"><History size={20} /></span>
        <div className="panel-title">
          <h2>History</h2>
          <p className="muted">Every change to this layout, newest first.</p>
        </div>
        <button type="button" className="icon-button" aria-label="Close the history" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      {blockedReason === null ? null : <p className="history-why" role="status">{blockedReason}</p>}
      {revisions.status === "idle" || revisions.status === "loading" ? (
        <p className="muted history-state" role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" /> Loading the history…</p>
      ) : revisions.status === "error" ? (
        <div className="history-state history-error" role="alert">
          <p>{revisions.message}</p>
          <button type="button" className="button" onClick={onReload}><RefreshCw size={14} aria-hidden="true" />Try again</button>
        </div>
      ) : (
        <ol className="revision-list" aria-label="Revisions">
          {revisions.items.map((revision) => (
            <li key={revision.id} className="revision" data-head={revision.isHead} data-origin={revision.origin}>
              <div className="revision-text">
                <p className="revision-summary">{revision.summary}</p>
                <p className="revision-meta">
                  <span className="revision-source">{sourceLabel(revision.origin)}</span>
                  <time dateTime={new Date(revision.createdAt).toISOString()} title={new Date(revision.createdAt).toLocaleString()}>{formatWhen(revision.createdAt, now)}</time>
                  {revision.isHead ? <span className="revision-current">Current</span> : null}
                </p>
              </div>
              <div className="revision-actions">
                {revision.isHead ? null : (
                  <button
                    type="button"
                    className="button"
                    disabled={blockedReason !== null || working !== null}
                    aria-label={`Go back to: ${revision.summary}`}
                    onClick={() => void goBack(revision)}
                  >
                    {working === revision.id ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <Undo2 size={14} aria-hidden="true" />}
                    Go back
                  </button>
                )}
                <button type="button" className="button" aria-label={`Flash this revision: ${revision.summary}`} onClick={() => onFlash(revision)}>
                  <Zap size={14} aria-hidden="true" />
                  Flash this
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
