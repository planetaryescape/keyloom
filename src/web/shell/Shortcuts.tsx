import { X } from "lucide-react";
import { useEffect, useRef } from "react";

// Only shortcuts that work are listed; the rest of 18#keyboard-use joins as its rung lands.
const SHORTCUTS: readonly { keys: readonly string[]; range?: true; does: string }[] = [
  { keys: ["Enter"], does: "Open the focused key's panel, or apply the panel's change" },
  { keys: ["Esc"], does: "Close the picker, then the panel" },
  { keys: ["1", "9"], range: true, does: "Switch to layer 1 to 9" },
  { keys: ["⇧", "Click"], does: "Select several keys, for a combo, a paste or typing keys onto them" },
  { keys: ["⌘", "C"], does: "Copy the open or selected key" },
  { keys: ["⌘", "V"], does: "Paste onto the selected keys, or the open key" },
  { keys: ["⌘", "Z"], does: "Undo the last change" },
  { keys: ["⇧", "⌘", "Z"], does: "Redo a change you undid" },
  { keys: ["⌘", "K"], does: "Open or close the chat" },
  { keys: ["?"], does: "Show this list" },
];

export function Shortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="shortcuts"
      aria-labelledby="shortcuts-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="shortcuts-head">
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <dl className="shortcut-list">
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.does}>
            <dt>
              {shortcut.keys.map((key, index) => (
                <span key={key}>
                  {index > 0 ? (shortcut.range === true ? " to " : " ") : ""}
                  <kbd>{key}</kbd>
                </span>
              ))}
            </dt>
            <dd>{shortcut.does}</dd>
          </div>
        ))}
      </dl>
    </dialog>
  );
}
