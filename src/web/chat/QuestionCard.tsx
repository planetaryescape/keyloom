import { Check } from "lucide-react";
import { useId, useState } from "react";
import type { QuestionCard as Question } from "../../api/http.ts";
import { optionForKey } from "./question-keys.ts";

interface Props {
  question: Question;
  /** A reply is already streaming from this answer, or another is. */
  disabled?: boolean;
  onAnswer: (toolUseId: string, text: string) => void;
}

// The agent's one question (D-381): the options are buttons, the first is its recommendation. Everything is visible at rest, and
// the number keys pick while the card has focus. Once answered it is a quiet, read-only line.
export function QuestionCard({ question, disabled = false, onAnswer }: Props) {
  const id = useId();
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const open = question.answer === null;

  // The log reveals the question, but arriving work must not take focus from someone typing elsewhere.

  if (!open) {
    return (
      <section className="ask-card ask-card-done" aria-label="Question, answered">
        <p className="ask-question">{question.question}</p>
        <p className="ask-answer"><Check size={14} aria-hidden="true" />{question.answer}</p>
      </section>
    );
  }

  const pick = (label: string) => {
    if (!disabled) onAnswer(question.toolUseId, label);
  };

  return (
    <section
      className="ask-card"
      aria-labelledby={`${id}-q`}
      tabIndex={0}
      onKeyDown={(event) => {
        if (typing || event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || event.altKey) return;
        const option = optionForKey(event.key, question.options);
        if (option !== undefined) {
          event.preventDefault();
          pick(option.label);
        }
      }}
    >
      <p id={`${id}-q`} className="ask-question">{question.question}</p>
      <ol className="ask-options">
        {question.options.map((option, index) => (
          <li key={option.label}>
            <button type="button" className="ask-option" disabled={disabled} onClick={() => pick(option.label)} aria-keyshortcuts={String(index + 1)}>
              <span className="ask-n" aria-hidden="true">{index + 1}</span>
              <span className="ask-text">
                <span className="ask-label">
                  {option.label}
                  {index === 0 ? <span className="ask-recommended">Recommended</span> : null}
                </span>
                {option.description === undefined ? null : <span className="ask-description">{option.description}</span>}
              </span>
            </button>
          </li>
        ))}
        {question.allowOther ? (
          <li>
            {typing ? (
              <form
                className="ask-other"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (text.trim() !== "") pick(text.trim());
                }}
              >
                <label htmlFor={`${id}-other`} className="sr-only">Your answer</label>
                <input
                  id={`${id}-other`}
                  value={text}
                  maxLength={500}
                  autoFocus
                  disabled={disabled}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setTyping(false);
                  }}
                />
                <button type="submit" className="button button-primary" disabled={disabled || text.trim() === ""}>Send</button>
                <button type="button" className="button" onClick={() => setTyping(false)}>Back</button>
              </form>
            ) : (
              <button type="button" className="ask-option ask-option-other" disabled={disabled} onClick={() => setTyping(true)}>
                <span className="ask-n" aria-hidden="true">…</span>
                <span className="ask-text"><span className="ask-label">Something else…</span></span>
              </button>
            )}
          </li>
        ) : null}
      </ol>
    </section>
  );
}
