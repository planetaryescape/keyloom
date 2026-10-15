import { SendHorizontal, Square, X } from "lucide-react";
import { type KeyboardEvent, type Ref } from "react";

export interface SelectedKeys {
  layerName: string;
  keys: { position: number; label: string }[];
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  selection: SelectedKeys | null;
  onRemoveKey: (position: number) => void;
  /** Opens a chip's key in the key panel (D-099: a key's panel opens from its chip while the chat is open). */
  onOpenKey?: (position: number) => void;
  onClearSelection: () => void;
  inputRef: Ref<HTMLTextAreaElement>;
}

const MAX_HEIGHT = 160;

export function Composer({ value, onChange, onSend, onStop, streaming, selection, onRemoveKey, onOpenKey, onClearSelection, inputRef }: Props) {
  const canSend = value.trim() !== "" && !streaming;

  // Grows with the text up to a cap, then scrolls; setting "auto" first lets it shrink again.
  const fit = (element: HTMLTextAreaElement | null) => {
    if (element === null) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`;
  };

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter while an input method is composing picks a candidate; it isn't a send.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canSend) onSend();
  }

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSend();
      }}
    >
      {selection === null ? null : (
        <div className="composer-selection">
          <span className="composer-selection-label">Asking about, on {selection.layerName}</span>
          <ul aria-label="Keys sent with your next message">
            {selection.keys.map((key) => (
              <li key={key.position} className="selected-chip">
                {onOpenKey === undefined ? (
                  <span title={`Key ${key.position + 1}`}>{key.label}</span>
                ) : (
                  <button type="button" className="chip-open" title={`Open key ${key.position + 1}`} onClick={() => onOpenKey(key.position)}>
                    {key.label}
                  </button>
                )}
                <button type="button" className="chip-remove" aria-label={`Remove key ${key.position + 1}, ${key.label}`} onClick={() => onRemoveKey(key.position)}>
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="link-button" onClick={onClearSelection}>Clear</button>
        </div>
      )}
      <div className="composer-row">
        <textarea
          ref={(element) => {
            fit(element);
            if (typeof inputRef === "function") inputRef(element);
            else if (inputRef !== null) inputRef.current = element;
          }}
          rows={1}
          value={value}
          aria-label="Message to keyloom"
          placeholder={selection === null ? "Describe what isn't working" : "Say what to do with these keys"}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {streaming ? (
          <button type="button" className="button" onClick={onStop}>
            <Square size={14} aria-hidden="true" />
            Stop
          </button>
        ) : (
          <button type="submit" className="button button-primary" disabled={!canSend}>
            <SendHorizontal size={14} aria-hidden="true" />
            Send
          </button>
        )}
      </div>
      <p className="composer-hint">Enter sends, Shift+Enter adds a line.</p>
    </form>
  );
}
