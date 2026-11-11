import { TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Slot } from "../../layout/change.ts";
import type { LayerReference } from "../../layout/layer-ops.ts";
import type { ChangeOutcome } from "../editor/useChange.ts";

/** Why Open combo can't open that combo now (R5-13), decided before the dialog closes, with the button that shows what is in the way. */
export type ComboOpenRefusal = { text: string; action: { label: string; run: () => void } };

interface Props {
  layerName: string;
  references: readonly LayerReference[];
  /** Conditional layers that name this layer; they are removed in the same change. */
  goesWith: readonly string[];
  /** `drops` are functions the person agreed to lose with the layer. */
  onDelete: (drops: readonly string[]) => Promise<ChangeOutcome>;
  /** A function in words ("Esc", "Hold Nav"), for the list of what would be lost. */
  nameFunction: (fn: string) => string;
  onOpenKey: (slot: Slot) => void;
  /** Opens a combo's card, where its output or its layers are changed (R4-09), or says why it can't yet and opens nothing. */
  onOpenCombo: (comboId: string) => ComboOpenRefusal | null;
  /** Removes a tap dance nothing uses, the one way past a dance that goes to this layer (#290 review). */
  onRemoveTapDance: (tapDanceId: string) => Promise<ChangeOutcome>;
  onClose: () => void;
}

/** The button beside a reference: the place where it is changed, or, for a tap dance nothing uses, removing it. */
export function referenceAction(reference: LayerReference): { label: string; open: { slot: Slot } | { comboId: string } | { tapDanceId: string } } | null {
  if (reference.comboId !== undefined) return { label: "Open combo", open: { comboId: reference.comboId } };
  if (reference.slot !== undefined) return { label: reference.tapDance === true ? "Open tap dance" : "Open key", open: { slot: reference.slot } };
  if (reference.tapDanceId !== undefined) return { label: "Remove tap dance", open: { tapDanceId: reference.tapDanceId } };
  return null;
}

/**
 * Opens the place a reference is changed. A key always opens and the dialog closes. A combo may refuse (R5-13): then the dialog stays
 * open and gets the refusal to show, so it never closes into a toast with no button.
 */
export function openReference(
  open: { slot: Slot } | { comboId: string },
  on: { openKey: (slot: Slot) => void; openCombo: (comboId: string) => ComboOpenRefusal | null; close: () => void },
): ComboOpenRefusal | null {
  if ("slot" in open) {
    on.close();
    on.openKey(open.slot);
    return null;
  }
  const refused = on.openCombo(open.comboId);
  if (refused === null) on.close();
  return refused;
}

// Deleting is the one layer action that can strand keys, so it lists what points at the layer first
// and asks the validator, which refuses while any of those keys would reach nothing (16#layers, D-090).
export function DeleteLayerDialog({ layerName, references, goesWith, onDelete, nameFunction, onOpenKey, onOpenCombo, onRemoveTapDance, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [outcome, setOutcome] = useState<Extract<ChangeOutcome, { ok: false }> | null>(null);
  const [busy, setBusy] = useState(false);
  // The dialog stays open with this rather than closing into a toast with no button (R5-13).
  const [comboRefusal, setComboRefusal] = useState<ComboOpenRefusal | null>(null);

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

  // Removing a dance stays in the dialog: the list is read again from the layout, so the row goes and Delete may come back.
  async function removeTapDance(tapDanceId: string) {
    setBusy(true);
    const result = await onRemoveTapDance(tapDanceId);
    setBusy(false);
    setOutcome(result.ok ? null : result);
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
            {references.map((reference) => {
              const action = referenceAction(reference);
              return (
                <li key={reference.text} className="layer-ref-row">
                  <span>{reference.text}</span>
                  {action === null ? null : (
                    <button
                      type="button"
                      className="button layer-ref-open"
                      disabled={busy}
                      onClick={() => {
                        const open = action.open;
                        if ("tapDanceId" in open) return void removeTapDance(open.tapDanceId);
                        setComboRefusal(openReference(open, { openKey: onOpenKey, openCombo: onOpenCombo, close: onClose }));
                      }}
                    >
                      {action.label}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="layer-dialog-lead">Nothing switches to {layerName}. The keys on it go with it, and Undo brings it back.</p>
      )}
      {goesWith.length === 0 ? null : (
        <p className="layer-dialog-lead">
          {goesWith.length === 1 ? "The condition" : "The conditions"} {goesWith.map((text) => `'${text}'`).join(", ")} {goesWith.length === 1 ? "goes" : "go"} with it.
        </p>
      )}
      {dropping.length === 0 ? null : (
        <div className="layer-dialog-lead" data-tone="warning" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>
            These are only on {layerName}, so deleting it drops them: {dropping.map(nameFunction).join(", ")}. Undo brings them back.
          </span>
        </div>
      )}
      {comboRefusal === null ? null : (
        <div className="layer-dialog-lead" data-tone="warning" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <div className="layer-combo-wait">
            <span>{comboRefusal.text}</span>
            <button type="button" className="button layer-ref-open" onClick={() => { onClose(); comboRefusal.action.run(); }}>{comboRefusal.action.label}</button>
          </div>
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
        {/* The validator refuses while anything switches here, so the button waits for the list to be empty and says so (R4-09). */}
        {stuck ? <span id="delete-layer-why" className="layer-dialog-why">Change what switches to {layerName} first.</span> : null}
        <button type="button" className="button" onClick={onClose}>Keep the layer</button>
        <button type="button" className="button button-danger" disabled={busy || stuck} aria-describedby={stuck ? "delete-layer-why" : undefined} onClick={() => void confirm()}>{dropping.length === 0 ? `Delete ${layerName}` : "Delete and drop them"}</button>
      </footer>
    </dialog>
  );
}
