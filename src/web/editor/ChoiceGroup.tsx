import { useId, type ReactNode } from "react";

export interface Choice<T extends string> {
  value: T;
  label: string;
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface Props<T extends string> {
  legend: string;
  /** Hide the legend visually but keep it for screen readers, when a heading already says it. */
  legendHidden?: boolean;
  choices: readonly Choice<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** "list" stacks full-width rows, "pills" wraps compact ones, "cards" shows each hint under its label. */
  variant: "list" | "pills" | "cards";
  autoFocus?: boolean;
}

// Native radio inputs behind styled labels: the arrow keys, the group semantics and the
// "one tab stop" behaviour all come from the browser.
export function ChoiceGroup<T extends string>({ legend, legendHidden = false, choices, value, onChange, variant, autoFocus = false }: Props<T>) {
  const name = useId();
  return (
    <fieldset className="field-group">
      <legend className={legendHidden ? "sr-only" : undefined}>{legend}</legend>
      <div className={`choices choices-${variant}`}>
        {choices.map((choice) => (
          <label key={choice.value} className="choice" data-disabled={choice.disabled === true}>
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={choice.value === value}
              disabled={choice.disabled === true}
              // Only the chosen radio takes focus; a null value leaves nothing to focus.
              ref={(element) => {
                if (element !== null && autoFocus && choice.value === value) element.focus({ preventScroll: true });
              }}
              onChange={() => onChange(choice.value)}
            />
            {choice.icon === undefined ? null : <span className="choice-icon" aria-hidden="true">{choice.icon}</span>}
            <span className="choice-text">
              <span className="choice-label">{choice.label}</span>
              {choice.hint === undefined ? null : <span className="choice-hint">{choice.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
