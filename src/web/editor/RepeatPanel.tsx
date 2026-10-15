import { ArrowRight, LoaderCircle, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { Layout } from "../../layout/schema.ts";
import { ApiError } from "../api.ts";
import { applyChange } from "../api-write.ts";
import { bindingSummary } from "./draft.ts";
import { planRepeat, repeatMeaning, repeatSummary, type LastChange } from "./repeat-plan.ts";
import { useCheckOps } from "./useCheckOps.ts";
import { Validation } from "./Validation.tsx";
import "./editor.css";

interface Props {
  token: string;
  layoutRef: string;
  layout: Layout;
  revisionId: string;
  /** The layer and keys of the selection the panel repeats onto. */
  layerId: string;
  positions: readonly number[];
  last: LastChange;
  onClose: () => void;
  /** Resolves once the new layout is on screen. */
  onApplied: (summary: string, firstPosition: number) => Promise<void>;
  onStale: () => void;
}

// Repeats the editor's last change on the selected keys as one change set (D-011): the same path an
// edit takes, so it is checked before it is saved and undoes as one step.
export function RepeatPanel({ token, layoutRef, layout, revisionId, layerId, positions, last, onClose, onApplied, onStale }: Props) {
  const plan = useMemo(() => planRepeat(layout, layerId, positions, last), [layout, layerId, positions, last]);
  const { state, recheck } = useCheckOps(token, layoutRef, revisionId, plan.ops);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const layerName = layout.layers.find((l) => l.id === layerId)?.name ?? layerId;

  const result = state.status === "done" ? state.result : null;
  const warnings = result?.warnings.length ?? 0;
  const canApply = plan.ops.length > 0 && result !== null && result.ok && !applying;
  const idleNote = plan.transform === null ? "The last change didn't change anything, so there is nothing to repeat." : "Every selected key already matches, or can't take this change.";

  async function apply() {
    if (!canApply) return;
    const summary = repeatSummary(layout, layerId, plan);
    setApplying(true);
    setApplyError(null);
    try {
      await applyChange(token, layoutRef, { baseRevisionId: revisionId, ops: plan.ops, summary });
      await onApplied(summary, plan.ops.length > 0 && plan.ops[0]?.op === "setBinding" ? plan.ops[0].at.position : positions[0] ?? 0);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.code?.startsWith("stale")) onStale();
      else setApplyError(error instanceof Error ? error.message : "The change could not be applied.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <section
      className="card editor repeat"
      aria-label="Repeat the last change on the selection"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="repeat-head">
        <div>
          <h2>Repeat the last change on {positions.length} {positions.length === 1 ? "key" : "keys"}</h2>
          <p className="muted">{plan.transform === null ? "The last change didn't change anything." : repeatMeaning(layout, last, plan.transform)}</p>
        </div>
        <button type="button" className="icon-button editor-close" aria-label="Close" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      {plan.rows.length === 0 ? null : (
        <ul className="repeat-rows" aria-label={`What changes on ${layerName}`}>
          {plan.rows.map((row) => (
            <li key={row.position} data-kind={row.kind}>
              <span className="repeat-key">Key {row.position + 1}</span>
              {row.kind === "change" ? (
                <span className="repeat-change">
                  {bindingSummary(row.before, layout)}
                  <ArrowRight size={14} aria-hidden="true" />
                  <strong>{bindingSummary(row.after, layout)}</strong>
                </span>
              ) : row.kind === "same" ? (
                <span className="muted">Already like this, no change</span>
              ) : (
                <span className="muted">Skipped: {row.reason}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <Validation layout={layout} idleNote={idleNote} state={state} onRecheck={recheck} />

      <footer className="editor-foot">
        <div className="editor-foot-note" aria-live="polite">
          {applyError !== null ? <p className="blocked" role="alert">{applyError}</p> : <p className="muted">Nothing is saved until you apply.</p>}
        </div>
        <button type="button" className="button" onClick={onClose} disabled={applying}>Cancel</button>
        <button type="button" className="button button-primary" disabled={!canApply} onClick={() => void apply()}>
          {applying ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
          {applying ? "Applying" : warnings > 0 ? `Apply with ${warnings} ${warnings === 1 ? "warning" : "warnings"}` : "Apply change"}
        </button>
      </footer>
    </section>
  );
}
