import { Repeat2, X } from "lucide-react";

interface Props {
  count: number;
  layerName: string;
  onClear: () => void;
  /** Offered once the editor has applied a change; null before that. */
  onRepeat: (() => void) | null;
  /** Why repeating isn't possible right now, shown as the button's tooltip. */
  repeatBlocked: string | null;
}

// The selection's size and the two things to do with it, where the keys are. The chat composer
// lists the same keys as chips; this is for people who are pointing and don't look down there.
export function SelectionBar({ count, layerName, onClear, onRepeat, repeatBlocked }: Props) {
  return (
    <div className="selection-bar" role="group" aria-label="Key selection">
      <p className="selection-count" aria-live="polite" data-empty={count === 0}>
        {count === 0 ? "Click keys to select them. The selection goes with your next chat message." : `${count} ${count === 1 ? "key" : "keys"} selected on ${layerName}`}
      </p>
      {count === 0 ? null : (
        <div className="selection-actions">
          {onRepeat === null ? null : (
            <button type="button" className="button" disabled={repeatBlocked !== null} title={repeatBlocked ?? "Do your last edit again on these keys"} onClick={onRepeat}>
              <Repeat2 size={14} aria-hidden="true" />
              Repeat last change
            </button>
          )}
          <button type="button" className="button" onClick={onClear}>
            <X size={14} aria-hidden="true" />
            Clear selection
          </button>
        </div>
      )}
    </div>
  );
}
