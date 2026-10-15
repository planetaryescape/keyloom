import { BookmarkCheck, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import type { PriorityCard } from "../../api/http.ts";
import type { Layout } from "../../layout/schema.ts";
import { priorityChipText } from "./priorities.ts";
import "./priority.css";

interface Props {
  priorities: readonly PriorityCard[];
  layout: Layout;
  /** Retires it on the server; rejects with a message to show. */
  onRemove: (id: string) => Promise<void>;
}

// What BK said that keyloom will remember. A misheard priority is one click to undo (08), so the
// remove button is on the chip itself and the chip says in his own words where it came from.
export function PriorityChips({ priorities, layout, onRemove }: Props) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (priorities.length === 0) return null;

  async function remove(id: string) {
    setRemoving(id);
    setProblem(null);
    try {
      await onRemove(id);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Couldn't forget that.");
      setRemoving(null);
    }
  }

  return (
    <div className="priorities" role="group" aria-label="Remembered from what you said">
      <p className="priorities-label">
        <BookmarkCheck size={14} aria-hidden="true" />
        Remembered
      </p>
      <ul>
        {priorities.map((card) => {
          const text = priorityChipText(card, layout);
          return (
            <li key={card.id} className="priority-chip" title={`You said: "${card.statement}"`} data-removing={removing === card.id}>
              <span>{text}</span>
              <button type="button" className="priority-forget" disabled={removing !== null} onClick={() => void remove(card.id)} aria-label={`Forget: ${text}`}>
                {removing === card.id ? <LoaderCircle size={12} className="spin" aria-hidden="true" /> : <X size={12} aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>
      {problem === null ? null : <p className="priorities-problem" role="alert">{problem}</p>}
    </div>
  );
}
