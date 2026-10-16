import { SendHorizontal, Sparkles, Square, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, type Ref } from "react";

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
  /** Why sending isn't possible whatever is typed, such as no model set up; shown under the box. */
  blockedReason?: string | null;
  /** Keys the ⌘K command rows take first (Enter, the arrows); true when one was used, so the box doesn't send. */
  onCommandKey?: (key: string) => boolean;
  /** The command bar's input (comp d): one quiet line, Enter sends, no Send button; an esc chip closes the bar. */
  quiet?: { onEscape: () => void; menu: ReactNode; placeholder: string };
}

const MAX_HEIGHT = 160;

export function Composer({ value, onChange, onSend, onStop, streaming, selection, onRemoveKey, onOpenKey, onClearSelection, inputRef, blockedReason = null, onCommandKey, quiet }: Props) {
  const canSend = value.trim() !== "" && !streaming && blockedReason === null;

  // Grows with the text up to a cap, then scrolls; setting "auto" first lets it shrink again.
  const fit = (element: HTMLTextAreaElement | null) => {
    if (element === null) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`;
  };

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.shiftKey) return;
    if ((event.key === "Enter" || event.key === "ArrowDown" || event.key === "ArrowUp") && onCommandKey?.(event.key) === true) {
      event.preventDefault();
      return;
    }
    // Enter while an input method is composing picks a candidate; it isn't a send.
    if (event.key !== "Enter") return;
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
                  <span>{key.label}</span>
                ) : (
                  <button type="button" className="chip-open" title={`Open ${key.label}`} onClick={() => onOpenKey(key.position)}>
                    {key.label}
                  </button>
                )}
                <button type="button" className="chip-remove" aria-label={`Remove ${key.label}`} onClick={() => onRemoveKey(key.position)}>
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="link-button" onClick={onClearSelection}>Clear</button>
        </div>
      )}
      <div className="composer-row">
        {quiet === undefined ? null : <Sparkles size={14} className="composer-mark" data-busy={streaming} aria-hidden="true" />}
        <textarea
          ref={(element) => {
            fit(element);
            if (typeof inputRef === "function") inputRef(element);
            else if (inputRef !== null) inputRef.current = element;
          }}
          rows={1}
          value={value}
          aria-label="Message to keyloom"
          placeholder={selection !== null ? "Say what to do with these keys" : quiet !== undefined ? quiet.placeholder : "Describe what isn't working"}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {quiet !== undefined ? (
          <>
            {streaming ? (
              <button type="button" className="bar-link composer-stop" onClick={onStop}>
                <Square size={12} aria-hidden="true" />
                Stop
              </button>
            ) : null}
            {quiet.menu}
            <button type="button" className="bar-esc" onClick={quiet.onEscape} aria-label="Close (Esc)">esc</button>
          </>
        ) : streaming ? (
          <button type="button" className="button" onClick={onStop}>
            <Square size={14} aria-hidden="true" />
            Stop
          </button>
        ) : (
          <button type="submit" className="button button-primary" disabled={!canSend} aria-describedby={blockedReason === null ? undefined : "composer-why"}>
            <SendHorizontal size={14} aria-hidden="true" />
            Send
          </button>
        )}
      </div>
      {quiet !== undefined ? null : blockedReason === null ? (
        <p className="composer-hint">Enter sends, Shift+Enter adds a line.</p>
      ) : (
        <p id="composer-why" className="composer-why">{blockedReason}</p>
      )}
    </form>
  );
}
