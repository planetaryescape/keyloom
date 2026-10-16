import "./configs.css";

// The sync pill's place while the config on screen isn't the one on the keyboard (c2, D-315): editing it never touches the keyboard,
// so the line says which config the keyboard runs, with the one way to change that.
export function EditingStatus({ name, onKeyboard, boardName, onPutOn }: { name: string; onKeyboard: string; boardName: string; onPutOn: () => void }) {
  return (
    <div className="config-editing" role="status">
      <span className="config-editing-what">Editing <b>{name}</b></span>
      <span className="config-editing-sep" aria-hidden="true">·</span>
      <span className="config-on config-editing-other"><i aria-hidden="true" />{onKeyboard} is on your {boardName}</span>
      <button type="button" className="config-editing-put" aria-label={`Put ${name} on your ${boardName}`} onClick={onPutOn}>
        <span className="config-editing-put-long">Put {name} on it</span>
        <span className="config-editing-put-short">Put on</span>
      </button>
    </div>
  );
}
