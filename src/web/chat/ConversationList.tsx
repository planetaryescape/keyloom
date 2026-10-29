import { ArrowLeft, LoaderCircle, MessageSquareText, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { ConversationSummary } from "../../api/http.ts";
import type { History } from "./useChat.ts";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

type Outcome = NonNullable<ConversationSummary["outcome"]>;

const outcomeWords = (outcome: Outcome): string =>
  outcome.kind === "applied" ? `Applied: ${outcome.title}` : outcome.kind === "options" ? `${outcome.count} ${outcome.count === 1 ? "option" : "options"} open` : "Talked it through";

// Titles stored before they were cut at a word end mid-word; this trims one back to its last whole word.
const wholeWords = (title: string): string => (title.length >= 60 && !title.endsWith("…") && title.includes(" ") ? `${title.slice(0, title.lastIndexOf(" "))}…` : title);

interface Props {
  history: History;
  currentId: string | null;
  onBack: () => void;
  onReload: () => void;
  /** Null means open; undefined means canceled or replaced; a string is an error. */
  onOpen: (id: string) => Promise<string | null | undefined>;
}

export function ConversationList({ history, currentId, onBack, onReload, onOpen }: Props) {
  const [opening, setOpening] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function open(id: string) {
    setOpening(id);
    setFailure(null);
    const error = await onOpen(id);
    setOpening(null);
    setFailure(error ?? null);
  }

  return (
    <div className="history">
      <button type="button" className="button history-back" onClick={onBack}>
        <ArrowLeft size={14} aria-hidden="true" />
        Back to chat
      </button>
      {failure === null ? null : <p className="chat-inline-error" role="alert">{failure}</p>}
      {history.status === "loading" || history.status === "idle" ? (
        <p className="muted" role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" /> Loading conversations…</p>
      ) : history.status === "error" ? (
        <div className="chat-inline-error" role="alert">
          <p>{history.message}</p>
          <button type="button" className="button" onClick={onReload}><RefreshCw size={14} aria-hidden="true" />Try again</button>
        </div>
      ) : history.items.length === 0 ? (
        <p className="muted">No earlier conversations about this layout yet.</p>
      ) : (
        <ul className="history-list" aria-label="Earlier conversations">
          {history.items.map((item) => (
            <li key={item.id}>
              <button type="button" className="history-item" aria-current={item.id === currentId} disabled={opening !== null} onClick={() => void open(item.id)}>
                <MessageSquareText size={16} aria-hidden="true" />
                <span className="history-text">
                  <span className="history-title">{wholeWords(item.title) || "Untitled conversation"}</span>
                  {item.outcome === undefined ? null : <span className="history-outcome" data-kind={item.outcome.kind}>{outcomeWords(item.outcome)}</span>}
                </span>
                <span className="history-when">{opening === item.id ? "Opening…" : when.format(item.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
