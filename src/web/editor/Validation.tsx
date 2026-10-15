import { CircleCheck, CircleX, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import type { Slot } from "../../layout/change.ts";
import type { Layout } from "../../layout/schema.ts";
import type { Issue, ValidationResult } from "../../validation/result.ts";
import type { CheckState } from "./useCheck.ts";

interface Props {
  layout: Layout;
  /** The key being edited, so issues about it read "This key" and others name their key. */
  slot: Slot;
  /** Why there is nothing to check: an incomplete or unchanged draft. */
  idleNote: string;
  state: CheckState;
  onRecheck: () => void;
}

function slotName(layout: Layout, slot: Slot): string {
  const layer = layout.layers.find((candidate) => candidate.id === slot.layerId)?.name ?? slot.layerId;
  return `${layer}, key ${slot.position + 1}`;
}

function IssueItem({ issue, kind, layout, slot }: { issue: Issue; kind: "error" | "warning"; layout: Layout; slot: Slot }) {
  const Icon = kind === "error" ? CircleX : TriangleAlert;
  const others = issue.slots ?? [];
  return (
    <li className={`issue issue-${kind}`}>
      <Icon size={16} aria-hidden="true" />
      <div>
        <p>
          <span className="sr-only">{kind === "error" ? "Error: " : "Warning: "}</span>
          {issue.message}
        </p>
        {others.length === 0 ? null : (
          <ul className="slot-chips" aria-label="Keys involved">
            {others.map((other) => (
              <li key={`${other.layerId}:${other.position}`} className="chip">{other.layerId === slot.layerId && other.position === slot.position ? "This key" : slotName(layout, other)}</li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function diffLine({ diff }: ValidationResult): string {
  const { changed, relearnCount } = diff;
  if (changed.length === 0) return "";
  return `Changes ${changed.length} ${changed.length === 1 ? "key" : "keys"}${relearnCount > 0 ? `, ${relearnCount} to relearn` : ""}`;
}

// Functions that move or disappear are worth their own lines; the headline count is not.
function DiffDetails({ result }: { result: ValidationResult }) {
  const { displaced, dropped } = result.diff;
  const moved = displaced.filter((d) => d.to !== null);
  if (moved.length === 0 && dropped.length === 0) return null;
  return (
    <div className="diff">
      <ul>
        {moved.map((d) => (
          <li key={`${d.function}:${d.from.position}`}>{d.function} moves from key {d.from.position + 1} to key {(d.to?.position ?? 0) + 1}.</li>
        ))}
        {dropped.map((d) => (
          <li key={d.function}>{d.function} is dropped: {d.reason}</li>
        ))}
      </ul>
    </div>
  );
}

function Summary({ result }: { result: ValidationResult }) {
  const line = diffLine(result);
  return (
    <>
      {line === "" ? null : <p className="diff-line">{line}.</p>}
      <DiffDetails result={result} />
    </>
  );
}

// Everything the validator said about the draft, in the order it matters: errors block Apply,
// warnings don't, and a clean pass says so rather than staying silent.
export function Validation({ layout, slot, idleNote, state, onRecheck }: Props) {
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
    const { errors, warnings } = state.result;
    body = (
      <>
        {errors.length === 0 && warnings.length === 0 ? (
          <p className="validation-note validation-ok">
            <CircleCheck size={16} aria-hidden="true" />
            No problems found
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
        {errors.length === 0 && warnings.length === 0 ? <DiffDetails result={state.result} /> : <Summary result={state.result} />}
      </>
    );
  }
  return (
    <div className="validation" aria-live="polite" aria-label="Validation">
      {body}
    </div>
  );
}
