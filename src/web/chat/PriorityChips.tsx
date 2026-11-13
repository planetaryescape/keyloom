import { BookmarkCheck, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import type { PriorityCard } from "../../api/http.ts";
import type { Layout } from "../../layout/schema.ts";
import { FailureNote } from "../shell/UnexpectedWayOut.tsx";
import { type PageFailure, pageFailure } from "../shell/unexpected.ts";
import { priorityChipText } from "./priorities.ts";
import "./priority.css";

interface Props {
  priorities: readonly PriorityCard[];
  layout: Layout;
  /** Retires it on the server; rejects with a message to show. */
  onRemove: (id: string) => Promise<void>;
  /** For Restart keyloom beside a failure no screen planned for (R8-03). The chip's own button is the Try again. */
  token?: string | undefined;
}

/**
 * One Forget. The chip leaves when it lands, but this component stays mounted for the turn's other chips, so `removing` is cleared on
 * success too (R10-02): every Forget is off while one runs, and a success must turn the rest back on.
 */
export async function forgetPriority(
  id: string,
  onRemove: (id: string) => Promise<void>,
  setRemoving: (id: string | null) => void,
  setProblem: (problem: PageFailure | null) => void,
): Promise<void> {
  setRemoving(id);
  setProblem(null);
  try {
    await onRemove(id);
  } catch (error) {
    setProblem(pageFailure(error, "Couldn't forget that."));
  } finally {
    setRemoving(null);
  }
}

// What BK said that keyloom will remember. A misheard priority is one click to undo (08), so the
// remove button is on the chip itself and the chip says in his own words where it came from.
export function PriorityChips({ priorities, layout, onRemove, token }: Props) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [problem, setProblem] = useState<PageFailure | null>(null);
  if (priorities.length === 0) return null;

  const remove = (id: string) => forgetPriority(id, onRemove, setRemoving, setProblem);

  return (
    <div className="priorities" role="group" aria-label="Remembered from what you said">
      <p className="priorities-label">
        <BookmarkCheck size={14} aria-hidden="true" />
        <span className="sr-only">Remembered</span>
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
      {problem === null ? null : <FailureNote token={token} failure={problem} className="priorities-problem" />}
    </div>
  );
}
