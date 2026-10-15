import { ArrowLeft, LoaderCircle, MessageSquareText, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { History } from "./useChat.ts";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

interface Props {
  history: History;
  currentId: string | null;
  onBack: () => void;
  onReload: () => void;
  /** Resolves to an error message, or null once it is open. */
  onOpen: (id: string) => Promise<string | null>;
}

export function ConversationList({ history, currentId, onBack, onReload, onOpen }: Props) {
  const [opening, setOpening] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function open(id: string) {
    setOpening(id);
    setFailure(null);
    const error = await onOpen(id);
    setOpening(null);
    setFailure(error);
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
                <span className="history-title">{item.title || "Untitled conversation"}</span>
                <span className="history-when">{opening === item.id ? "Opening…" : when.format(item.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
