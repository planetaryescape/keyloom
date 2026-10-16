import { ClipboardPaste, Keyboard as KeyboardIcon, MousePointerClick, Spline, X } from "lucide-react";

/** Typed keys waiting to be given to the selected keys (16#moving-and-copying-keys). */
export interface QuickAssign {
  /** What each typed key is called, in the order typed. */
  labels: readonly string[];
  /** How many keys are selected, so the bar can say how many are left. */
  total: number;
}

interface Props {
  count: number;
  layerName: string;
  /** Taps select keys instead of opening them, for a screen with no Shift key. */
  selectMode: boolean;
  onSelectMode: (on: boolean) => void;
  onClear: () => void;
  onCombo: () => void;
  /** What is copied, in words ("Esc"), or null when nothing is. */
  copied: string | null;
  onPaste: () => void;
  quick: QuickAssign | null;
  onQuickStart: () => void;
  onQuickApply: () => void;
  onQuickCancel: () => void;
  busy: boolean;
}

// The selection's size and what can be done with it, above the board where the keys are. The chat
// composer lists the same keys as chips.
export function SelectionBar({ count, layerName, selectMode, onSelectMode, onClear, onCombo, copied, onPaste, quick, onQuickStart, onQuickApply, onQuickCancel, busy }: Props) {
  if (quick !== null) {
    return (
      <div className="selection-bar" role="group" aria-label="Type to assign" data-mode="quick">
        <p className="selection-count" aria-live="polite">
          {quick.labels.length === 0
            ? `Type the keys for the ${quick.total} selected ${quick.total === 1 ? "key" : "keys"}, in order.`
            : `Typed ${quick.labels.join(" ")}. ${quick.labels.length} of ${quick.total}.`}
          <span className="muted"> Enter applies, Backspace undoes one, Esc cancels.</span>
        </p>
        <div className="selection-actions">
          <button type="button" className="button button-primary" disabled={quick.labels.length === 0 || busy} onClick={onQuickApply}>
            Apply {quick.labels.length} {quick.labels.length === 1 ? "key" : "keys"}
          </button>
          <button type="button" className="button" onClick={onQuickCancel}>Cancel</button>
        </div>
      </div>
    );
  }
  // Nothing selected is the board at rest: the bar appears only once there is a selection, or while taps select (23#chrome-recedes).
  if (count === 0 && !selectMode) return null;
  return (
    <div className="selection-bar" role="group" aria-label="Key selection">
      <p className="selection-count" aria-live="polite" data-empty={count === 0}>
        {count === 0
          ? selectMode
            ? "Tap keys to select them."
            : "Shift-click keys to select several."
          : `${count} ${count === 1 ? "key" : "keys"} selected on ${layerName}`}
      </p>
      <div className="selection-actions">
        {count === 0 ? null : (
          <>
            <button type="button" className="button" disabled={count < 2} title={count < 2 ? "Select a second key to make a combo" : "Press these keys together to send something else"} onClick={onCombo}>
              <Spline size={14} aria-hidden="true" />
              Make a combo
            </button>
            <button type="button" className="button" title="Type keys to give them to the selected keys in order" onClick={onQuickStart}>
              <KeyboardIcon size={14} aria-hidden="true" />
              Type to assign
            </button>
            {copied === null ? null : (
              <button type="button" className="button" disabled={busy} title={`Put ${copied} on each selected key`} onClick={onPaste}>
                <ClipboardPaste size={14} aria-hidden="true" />
                Paste {copied}
              </button>
            )}
            <button type="button" className="button" onClick={onClear}>
              <X size={14} aria-hidden="true" />
              Clear
            </button>
          </>
        )}
        <button type="button" className="toggle-button" aria-pressed={selectMode} title="Tapping a key selects it instead of opening it" onClick={() => onSelectMode(!selectMode)}>
          <MousePointerClick size={14} aria-hidden="true" />
          Select keys
        </button>
      </div>
    </div>
  );
}
