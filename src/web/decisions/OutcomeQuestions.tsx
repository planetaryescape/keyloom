import { LoaderCircle } from "lucide-react";
import { useId, useState } from "react";
import type { DecisionCard, OutcomeAnswer, OutcomeQuestionsResponse } from "../../api/http.ts";
import "./decisions.css";

type Question = OutcomeQuestionsResponse["questions"][number];

interface Props {
  questions: readonly Question[];
  /** Rejects with a message to show. */
  onAnswer: (id: string, answer: OutcomeAnswer) => Promise<void>;
}

const MAX_SHOWN = 2;
const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

// Q6: once, a week after a flash, keyloom asks whether a choice worked out. One question per
// hypothesis, a verdict in BK's words or "not now", and the card goes away either way.
export function OutcomeQuestions({ questions, onAnswer }: Props) {
  if (questions.length === 0) return null;
  const shown = questions.slice(0, MAX_SHOWN);
  return (
    <>
      {shown.map((q) => (
        <Ask key={q.decision.id} decision={q.decision} flashedAt={q.flashedAt} onAnswer={onAnswer} />
      ))}
      {questions.length > MAX_SHOWN ? <p className="muted outcome-more">{questions.length - MAX_SHOWN} more to ask about after these.</p> : null}
    </>
  );
}

function Ask({ decision, flashedAt, onAnswer }: { decision: DecisionCard; flashedAt: number; onAnswer: Props["onAnswer"] }) {
  const id = useId();
  const [verdict, setVerdict] = useState<"tried_helpful" | "tried_unhelpful" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function send(answer: OutcomeAnswer) {
    setBusy(true);
    setProblem(null);
    try {
      await onAnswer(decision.id, answer);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That didn't save.");
      setBusy(false);
    }
  }

  return (
    <section className="outcome-ask" aria-label="Has this worked out?">
      <p className="outcome-title">Has this worked out? {decision.choice}</p>
      <p className="outcome-meta">You flashed it on {when.format(flashedAt)}. Reason at the time: {decision.reason}</p>
      {verdict === null ? (
        <div className="outcome-actions">
          <button type="button" className="button" disabled={busy} onClick={() => setVerdict("tried_helpful")}>It helped</button>
          <button type="button" className="button" disabled={busy} onClick={() => setVerdict("tried_unhelpful")}>It didn&apos;t help</button>
          <button type="button" className="button" disabled={busy} onClick={() => void send({ dismiss: true })}>
            {busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
            Not now
          </button>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (note.trim() !== "") void send({ status: verdict, note: note.trim() });
          }}
        >
          <label htmlFor={`${id}-note`} className="outcome-meta">What did you notice?</label>
          <input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} disabled={busy} autoFocus />
          <div className="outcome-actions">
            <button type="submit" className="button button-primary" disabled={busy || note.trim() === ""}>
              {busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
              Save
            </button>
            <button type="button" className="button" disabled={busy} onClick={() => setVerdict(null)}>Back</button>
          </div>
        </form>
      )}
      {problem === null ? null : <p role="alert" className="decision-problem">{problem}</p>}
    </section>
  );
}
