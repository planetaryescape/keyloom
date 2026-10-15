import { TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Slot } from "../../layout/change.ts";
import type { LayerReference } from "../../layout/layer-ops.ts";
import type { ChangeOutcome } from "../editor/useChange.ts";

interface Props {
  layerName: string;
  references: readonly LayerReference[];
  /** `drops` are functions the person agreed to lose with the layer. */
  onDelete: (drops: readonly string[]) => Promise<ChangeOutcome>;
  /** A function in words ("Esc", "Hold Nav"), for the list of what would be lost. */
  nameFunction: (fn: string) => string;
  onOpenKey: (slot: Slot) => void;
  onClose: () => void;
}

// Deleting is the one layer action that can strand keys, so it lists what points at the layer first
// and asks the validator, which refuses while any of those keys would reach nothing (16#layers, D-090).
export function DeleteLayerDialog({ layerName, references, onDelete, nameFunction, onOpenKey, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [outcome, setOutcome] = useState<Extract<ChangeOutcome, { ok: false }> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
  }, []);

  // Functions that live only on this layer: asked about once, then dropped with the layer in the same change.
  const [dropping, setDropping] = useState<readonly string[]>([]);

  async function confirm() {
    setBusy(true);
    const result = await onDelete(dropping);
    setBusy(false);
    if (result.ok) onClose();
    else if (result.lost.length > 0 && dropping.length === 0) {
      setDropping(result.lost);
      setOutcome(null);
    } else setOutcome(result);
  }

  const stuck = references.length > 0;
  return (
    <dialog ref={dialog} className="layer-dialog" aria-labelledby="delete-layer-title" onClose={onClose} onClick={(event) => event.target === event.currentTarget && onClose()}>
      <header className="shortcuts-head">
        <h2 id="delete-layer-title">Delete {layerName}?</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      {stuck ? (
        <>
          <p className="layer-dialog-lead" data-tone="warning">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>
              {references.length === 1 ? "1 thing switches" : `${references.length} things switch`} to {layerName}. keyloom won&apos;t delete a layer while any of them would reach nothing.
            </span>
          </p>
          <ul className="layer-refs" aria-label={`What switches to ${layerName}`}>
            {references.map((reference) => (
              <li key={reference.text}>
                {reference.slot === undefined ? (
                  <span>{reference.text}</span>
                ) : (
                  <button type="button" className="layer-ref" onClick={() => reference.slot !== undefined && (onClose(), onOpenKey(reference.slot))}>
                    {reference.text}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="layer-dialog-lead">Nothing switches to {layerName}. The keys on it go with it, and Undo brings it back.</p>
      )}
      {dropping.length === 0 ? null : (
        <div className="layer-dialog-lead" data-tone="warning" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>
            These are only on {layerName}, so deleting it drops them: {dropping.map(nameFunction).join(", ")}. Undo brings them back.
          </span>
        </div>
      )}
      {outcome === null ? null : (
        <div className="layer-refused" role="alert">
          <strong>{outcome.message}</strong>
          {outcome.problems.length === 0 ? null : (
            <ul>
              {outcome.problems.slice(0, 6).map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          )}
        </div>
      )}
      <footer className="layer-dialog-foot">
        <button type="button" className="button" onClick={onClose}>Keep the layer</button>
        <button type="button" className="button button-danger" disabled={busy} onClick={() => void confirm()}>{dropping.length === 0 ? `Delete ${layerName}` : "Delete and drop them"}</button>
      </footer>
    </dialog>
  );
}
