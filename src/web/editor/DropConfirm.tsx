import { TriangleAlert } from "lucide-react";
import { useEffect, useRef } from "react";

interface Props {
  /** What the change is, as it will read in the history. */
  summary: string;
  /** Functions in words that exist nowhere else and would be dropped. */
  names: readonly string[];
  onConfirm: () => void;
  onCancel: () => void;
}

// The board's moves (paste, drop, typing) can overwrite the only copy of a function. Like the key
// panel (D-092), keyloom says so in plain words and lets the person choose, never drops silently.
export function DropConfirm({ summary, names, onConfirm, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
  }, []);
  return (
    <dialog ref={dialog} className="layer-dialog" aria-labelledby="drop-confirm-title" onClose={onCancel} onClick={(event) => event.target === event.currentTarget && onCancel()}>
      <h2 id="drop-confirm-title" className="drop-title">This replaces the only copy of {names.length === 1 ? "a key" : `${names.length} keys`}</h2>
      <p className="layer-dialog-lead" data-tone="warning">
        <TriangleAlert size={16} aria-hidden="true" />
        <span>{names.join(", ")} {names.length === 1 ? "isn't" : "aren't"} on any other key, so this change drops {names.length === 1 ? "it" : "them"}. Undo brings {names.length === 1 ? "it" : "them"} back.</span>
      </p>
      <p className="muted drop-summary">{summary}</p>
      <footer className="layer-dialog-foot">
        <button type="button" className="button" onClick={onCancel}>Keep {names.length === 1 ? "it" : "them"}</button>
        <button type="button" className="button button-danger" onClick={onConfirm}>Replace and drop {names.length === 1 ? "it" : "them"}</button>
      </footer>
    </dialog>
  );
}
