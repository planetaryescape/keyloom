import { Check, Keyboard, Layers } from "lucide-react";
import { useId, useState } from "react";
import type { QuestionCard as Question } from "../../api/http.ts";
import { optionForKey } from "./question-keys.ts";

interface Props {
  question: Question;
  /** A reply is already streaming from this answer, or another is. */
  disabled?: boolean;
  onAnswer: (toolUseId: string, text: string) => void;
}

/** "Question n of m" when there is more than one to come, the question, and the few lines on why it matters (D-452). */
function QuestionHead({ id, question }: { id: string; question: Question }) {
  const { step, considerations } = question;
  return (
    <>
      {step !== undefined && step.of >= 2 ? <p className="ask-kicker">Question {step.n} of {step.of}</p> : null}
      <p id={id} className="ask-question">{question.question}</p>
      {considerations === undefined || considerations.length === 0 ? null : (
        <ul className="ask-considerations" aria-label="What matters">
          {considerations.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
    </>
  );
}

// The agent's question to BK (D-381, Rung 27): interactive question kinds (single/multiple choice, short text, layer, key, keyboard).
// Once answered it is a quiet, read-only line.
export function QuestionCard({ question, disabled = false, onAnswer }: Props) {
  const id = useId();
  const [typing, setTyping] = useState(question.kind === "short_text");
  const [text, setText] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // BK applied the proposal this question refines, so it needs no answer (D-452); a question closed by another apply says so on itself.
  const skipped = question.skipped === true;
  const open = question.answer === null && !skipped;
  const kind = question.kind ?? "single_choice";

  if (!open) {
    return (
      <section className="ask-card ask-card-done" aria-label="Question, answered">
        <p className="ask-question">{question.question}</p>
        <p className="ask-answer"><Check size={14} aria-hidden="true" />{question.closed === true ? "Closed, you applied another proposal" : skipped ? "Skipped, you applied the proposal" : question.answer}</p>
      </section>
    );
  }

  const pick = (value: string) => {
    if (!disabled) onAnswer(question.toolUseId, value);
  };

  const toggleMultiple = (value: string) => {
    const next = new Set(selectedIds);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setSelectedIds(next);
  };

  if (kind === "short_text") {
    return (
      <section className="ask-card" aria-labelledby={`${id}-q`} tabIndex={0}>
        <QuestionHead id={`${id}-q`} question={question} />
        <form
          className="ask-other"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim() !== "") pick(text.trim());
          }}
        >
          <label htmlFor={`${id}-input`} className="sr-only">Your answer</label>
          <input
            id={`${id}-input`}
            value={text}
            placeholder={question.placeholder ?? "Type your answer…"}
            maxLength={500}
            autoFocus
            disabled={disabled}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="submit" className="button button-primary" disabled={disabled || text.trim() === ""}>Send</button>
        </form>
      </section>
    );
  }

  if (kind === "multiple_choice") {
    return (
      <section className="ask-card" aria-labelledby={`${id}-q`} tabIndex={0}>
        <QuestionHead id={`${id}-q`} question={question} />
        <ul className="ask-options">
          {question.options.map((option) => {
            const optVal = option.id ?? option.label;
            const checked = selectedIds.has(optVal);
            return (
              <li key={optVal}>
                <label className="ask-option ask-option-checkbox">
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={checked}
                    onChange={() => toggleMultiple(optVal)}
                  />
                  <span className="ask-text">
                    <span className="ask-label">{option.label}</span>
                    {option.description === undefined ? null : <span className="ask-description">{option.description}</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="ask-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={disabled || selectedIds.size === 0}
            onClick={() => pick(Array.from(selectedIds).join(", "))}
          >
            Submit choice ({selectedIds.size})
          </button>
        </div>
      </section>
    );
  }

  if (kind === "layer") {
    return (
      <section className="ask-card" aria-labelledby={`${id}-q`} tabIndex={0}>
        <QuestionHead id={`${id}-q`} question={question} />
        <div className="ask-chips" role="group" aria-label="Layers">
          {question.options.map((option) => {
            const optVal = option.id ?? option.label;
            return (
              <button
                key={optVal}
                type="button"
                className="button ask-layer-chip"
                disabled={disabled}
                onClick={() => pick(optVal)}
              >
                <Layers size={14} aria-hidden="true" />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  if (kind === "keyboard_or_config") {
    return (
      <section className="ask-card" aria-labelledby={`${id}-q`} tabIndex={0}>
        <QuestionHead id={`${id}-q`} question={question} />
        <ol className="ask-options">
          {question.options.map((option, index) => {
            const optVal = option.id ?? option.label;
            const isRecommended = option.recommended === true || (option.recommended === undefined && index === 0);
            return (
              <li key={optVal}>
                <button type="button" className="ask-option" disabled={disabled} onClick={() => pick(optVal)} aria-keyshortcuts={String(index + 1)}>
                  <Keyboard size={16} aria-hidden="true" className="ask-icon" />
                  <span className="ask-text">
                    <span className="ask-label">
                      {option.label}
                      {isRecommended ? <span className="ask-recommended">Recommended</span> : null}
                    </span>
                    {option.description === undefined ? null : <span className="ask-description">{option.description}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </section>
    );
  }

  if (kind === "key") {
    return (
      <section className="ask-card" aria-labelledby={`${id}-q`} tabIndex={0}>
        <QuestionHead id={`${id}-q`} question={question} />
        <p className="ask-instruction">Click a key on the board, or pick one from the options below:</p>
        <ol className="ask-options">
          {question.options.map((option, index) => {
            const optVal = option.id ?? option.label;
            return (
              <li key={optVal}>
                <button type="button" className="ask-option" disabled={disabled} onClick={() => pick(optVal)} aria-keyshortcuts={String(index + 1)}>
                  <span className="ask-n" aria-hidden="true">{index + 1}</span>
                  <span className="ask-text">
                    <span className="ask-label">{option.label}</span>
                    {option.description === undefined ? null : <span className="ask-description">{option.description}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </section>
    );
  }

  // Default: single_choice
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
          pick(option.id ?? option.label);
        }
      }}
    >
      <QuestionHead id={`${id}-q`} question={question} />
      <ol className="ask-options">
        {question.options.map((option, index) => {
          const optVal = option.id ?? option.label;
          const isRecommended = option.recommended === true || (option.recommended === undefined && index === 0);
          return (
            <li key={optVal}>
              <button type="button" className="ask-option" disabled={disabled} onClick={() => pick(optVal)} aria-keyshortcuts={String(index + 1)}>
                <span className="ask-n" aria-hidden="true">{index + 1}</span>
                <span className="ask-text">
                  <span className="ask-label">
                    {option.label}
                    {isRecommended ? <span className="ask-recommended">Recommended</span> : null}
                  </span>
                  {option.description === undefined ? null : <span className="ask-description">{option.description}</span>}
                </span>
              </button>
            </li>
          );
        })}
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
