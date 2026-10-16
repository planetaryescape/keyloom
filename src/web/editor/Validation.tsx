import { CircleCheck, CircleX, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import type { Slot } from "../../layout/change.ts";
import type { Layout } from "../../layout/schema.ts";
import type { Issue, ValidationResult } from "../../validation/result.ts";
import { Reminders } from "../decisions/Reminders.tsx";
import { functionLabel } from "./function-label.ts";
import type { CheckState } from "./useCheck.ts";
import { keyIn } from "../../validation/words.ts";

interface Props {
  layout: Layout;
  /** The key being edited, so issues about it read "This key" and others name their key. Omitted for a proposal, where every key is named. */
  slot?: Slot;
  /** Why there is nothing to check: an incomplete or unchanged draft. */
  idleNote: string;
  state: CheckState;
  onRecheck: () => void;
  /** A card that lists moves itself passes false, so they aren't said twice. */
  showMoves?: boolean;
  /** The editor asks about lost functions itself (LostFunctions), so they aren't listed a second time. */
  hideLost?: boolean;
}

// A key by what it prints, never its number (D-279); the board lights which one.
const slotName = (layout: Layout, slot: Slot): string => keyIn(layout, slot);

function IssueItem({ issue, kind, layout, slot }: { issue: Issue; kind: "error" | "warning"; layout: Layout; slot: Slot | undefined }) {
  const Icon = kind === "error" ? CircleX : TriangleAlert;
  const others = issue.slots ?? [];
  return (
    <li className={`issue issue-${kind}`}>
      <Icon size={16} aria-hidden="true" />
      <div>
        <p>
          <span className="sr-only">{kind === "error" ? "Error: " : "Warning: "}</span>
          {issue.plain ?? issue.message}
        </p>
        {others.length === 0 ? null : (
          <ul className="slot-chips" aria-label="Keys involved">
            {others.map((other) => (
              <li key={`${other.layerId}:${other.position}`} className="chip">{slot !== undefined && other.layerId === slot.layerId && other.position === slot.position ? "This key" : slotName(layout, other)}</li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function diffLine({ diff }: ValidationResult): string {
  const { changed, relearnCount, retuned } = diff;
  const retunes = retuned.length === 0 ? "" : `retunes ${retuned.length} hold-tap ${retuned.length === 1 ? "key" : "keys"}`;
  if (changed.length === 0) return retunes === "" ? "" : `${retunes[0]?.toUpperCase()}${retunes.slice(1)}`;
  return `Changes ${changed.length} ${changed.length === 1 ? "key" : "keys"}${relearnCount > 0 ? `, ${relearnCount} to relearn` : ""}${retunes === "" ? "" : `, ${retunes}`}`;
}

// Functions that move or disappear are worth their own lines; the headline count is not.
function DiffDetails({ result, layout }: { result: ValidationResult; layout: Layout }) {
  const { displaced, dropped } = result.diff;
  const moved = displaced.filter((d) => d.to !== null);
  if (moved.length === 0 && dropped.length === 0) return null;
  return (
    <div className="diff">
      <ul>
        {moved.map((d) => (
          <li key={`${d.function}:${d.from.layerId}:${d.from.position}`}>
            {functionLabel(d.function, layout)} moves from {slotName(layout, d.from)} to {d.to === null ? "nowhere" : slotName(layout, d.to)}.
          </li>
        ))}
        {dropped.map((d) => (
          <li key={d.function}>{functionLabel(d.function, layout)} is dropped: {d.reason}</li>
        ))}
      </ul>
    </div>
  );
}

function Summary({ result, layout, showMoves }: { result: ValidationResult; layout: Layout; showMoves: boolean }) {
  const line = diffLine(result);
  return (
    <>
      {line === "" ? null : <p className="diff-line">{line}.</p>}
      {showMoves ? <DiffDetails result={result} layout={layout} /> : null}
    </>
  );
}

// Everything the validator said about the draft, in the order it matters: errors block Apply,
// warnings don't, and a clean pass says so rather than staying silent.
export function Validation({ layout, slot, idleNote, state, onRecheck, showMoves = true, hideLost = false }: Props) {
  let body;
  if (state.status === "idle") {
    body = (
      <p className="validation-note">
        <Info size={16} aria-hidden="true" />
        {idleNote}
      </p>
    );
  } else if (state.status === "checking") {
    body = (
      <p className="validation-note">
        <LoaderCircle size={16} className="spin" aria-hidden="true" />
        Checking this change
      </p>
    );
  } else if (state.status === "error") {
    body = (
      <div className="validation-note validation-note-error" role="alert">
        <CircleX size={16} aria-hidden="true" />
        <span>{state.message}</span>
        {state.stale ? null : (
          <button type="button" className="button" onClick={onRecheck}>
            Check again
          </button>
        )}
      </div>
    );
  } else {
    const all = state.result.errors;
    const errors = hideLost ? all.filter((issue) => issue.code !== "function_lost") : all;
    const hiddenLost = all.length - errors.length;
    // A reminder is shown in full below, with the reason quoted, so its warning is not listed twice.
    const warnings = state.result.warnings.filter((w) => w.code !== "contradicts_decision");
    body = (
      <>
        <Reminders reminders={state.result.diff.reminders} layout={layout} />
        {errors.length === 0 && warnings.length === 0 && hiddenLost > 0 ? null : errors.length === 0 && warnings.length === 0 ? (
          <p className="validation-note validation-ok">
            <CircleCheck size={16} aria-hidden="true" />
            <span className="validation-ok-label">No problems found</span>
            <span className="validation-diff">{diffLine(state.result)}</span>
          </p>
        ) : (
          <ul className="issues">
            {errors.map((issue, index) => (
              <IssueItem key={`e${index}`} issue={issue} kind="error" layout={layout} slot={slot} />
            ))}
            {warnings.map((issue, index) => (
              <IssueItem key={`w${index}`} issue={issue} kind="warning" layout={layout} slot={slot} />
            ))}
          </ul>
        )}
        {errors.length === 0 && warnings.length === 0 ? (showMoves ? <DiffDetails result={state.result} layout={layout} /> : null) : <Summary result={state.result} layout={layout} showMoves={showMoves} />}
      </>
    );
  }
  return (
    <div className="validation" aria-live="polite" aria-label="Validation">
      {body}
    </div>
  );
}
