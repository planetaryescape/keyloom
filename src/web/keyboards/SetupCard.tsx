import { LoaderCircle, Plus, Usb, X } from "lucide-react";
import { useState } from "react";
import type { NewKeyboard } from "./useNewKeyboard.ts";
import "./keyboards.css";

// The "known board, no config" card (D-336): keyloom recognizes the keyboard on USB but has nothing on it yet. Without this the board is
// invisible, because the board switch lists only boards that have a config. Every choice is a visible button, as on the new-keyboard card.
export function SetupCard({ flow, onImport, onMade }: {
  flow: NewKeyboard;
  /** Opens the import screen, where the board's own export (Oryx, the MoErgo editor, a zmk-config) is dropped. */
  onImport: () => void;
  onMade: (configId: string) => void;
}) {
  const { step } = flow;
  const [name, setName] = useState("");
  if (step.kind !== "setup") return null;
  const startBlank = async () => {
    const id = await flow.startBlank(name.trim() === "" ? `${step.boardName} blank` : name);
    if (id !== null) onMade(id);
  };
  return (
    <section className="nb-card" aria-label={`${step.boardName} has no config yet`}>
      <header className="nb-card-head">
        <div>
          <p className="nb-eyebrow"><Usb size={13} aria-hidden="true" />Just plugged in</p>
          <h2>Your {step.boardName} has no config yet</h2>
        </div>
        <button type="button" className="sheet-close" aria-label="Not now" onClick={flow.notNow}><X size={16} aria-hidden="true" /></button>
      </header>
      <p className="nb-lead">
        keyloom knows this keyboard, but nothing of yours is on it. Put one of your configs on it, import the layout you already use, or start
        from a blank one. Nothing is written to the keyboard until you apply a change.
      </p>
      <div className="nb-list nb-setup-list">
        <button type="button" onClick={flow.startPut}>
          <span className="nb-setup-body"><b>Put one of my configs on it</b><small>Map a config you already use onto this keyboard, as a new config.</small></span>
        </button>
        <button type="button" onClick={onImport}>
          <span className="nb-setup-body"><b>Import a layout</b><small>Drop the export from Oryx, the MoErgo editor or your zmk-config.</small></span>
        </button>
      </div>
      <div className="nb-blank">
        <label className="nb-blank-label" htmlFor="nb-blank-name">Or start blank</label>
        <div className="nb-blank-row">
          <input id="nb-blank-name" className="nb-blank-input" value={name} placeholder={`${step.boardName} blank`} autoComplete="off" spellCheck={false} onChange={(e) => setName(e.target.value)} />
          <button type="button" className="sheet-action" disabled={flow.busy} onClick={() => void startBlank()}>
            {flow.busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
            Start blank
          </button>
        </div>
      </div>
      {flow.problem === null ? null : <p className="nb-problem" role="alert">{flow.problem}</p>}
      <footer className="nb-foot">
        <span className="nb-note">keyloom only reads the keyboard. Nothing is written to it.</span>
        <button type="button" className="sheet-action" onClick={flow.notNow}>Not now</button>
      </footer>
    </section>
  );
}
