import { Laptop, LoaderCircle, Plus, Usb, X } from "lucide-react";
import { useState } from "react";
import type { BoardChoice } from "../../api/http.ts";
import { importLine } from "../import/export-steps.ts";
import type { NewKeyboard } from "./useNewKeyboard.ts";
import { RestoreKeyboard } from "./RestoreKeyboard.tsx";
import { setupFoot, setupWrites } from "./onboarding-words.ts";
import "./keyboards.css";

// The "known board, no config" card (D-336): keyloom recognizes the keyboard on USB but has nothing on it yet. Without this the board is
// invisible, because the board switch lists only boards that have a config. Every choice is a visible button, as on the new-keyboard card.
export function SetupCard({ flow, boards = [], hasConfigs, onImport, onMade }: {
  flow: NewKeyboard;
  /** The boards keyloom has, for where the layout of the one being set up comes from (R6-11). */
  boards?: readonly BoardChoice[];
  /** False on a first run: with no config to put on it, that choice is not offered (R1-25). */
  hasConfigs: boolean;
  /** Opens the import screen at this board's card, where its own export (Oryx, the MoErgo editor, a zmk-config) is dropped (R7-13). */
  onImport: (boardId: string) => void;
  onMade: (configId: string) => void;
}) {
  const { step } = flow;
  const [name, setName] = useState("");
  if (step.kind !== "setup") return null;
  const board = boards.find((b) => b.id === step.boardId);
  const firmware = board?.firmware;
  const startBlank = async () => {
    const id = name.trim() === "" ? await flow.startBlank(`${step.boardName} blank`, { free: true }) : await flow.startBlank(name);
    if (id !== null) onMade(id);
  };
  return (
    <section className="nb-card" aria-label={`${step.boardName} has no config yet`}>
      <header className="nb-card-head">
        <div>
          <p className="nb-eyebrow">{firmware === "kanata" ? <Laptop size={13} aria-hidden="true" /> : <Usb size={13} aria-hidden="true" />}{step.keyboard === null ? "Set up a keyboard" : "Just plugged in"}</p>
          <h2>Your {step.boardName} has no config yet</h2>
        </div>
        <button type="button" className="sheet-close" aria-label="Not now" onClick={flow.notNow}><X size={16} aria-hidden="true" /></button>
      </header>
      <p className="nb-lead">
        keyloom knows this keyboard, but nothing of yours is on it. {hasConfigs ? "Put one of your configs on it, import" : "Import"} the layout you
        already use, or start from a blank one. {setupWrites(firmware)}
      </p>
      <div className="nb-list nb-setup-list">
        {hasConfigs ? (
          <button type="button" onClick={flow.startPut}>
            <span className="nb-setup-body"><b>Put one of my configs on it</b><small>Map a config you already use onto this keyboard, as a new config.</small></span>
          </button>
        ) : null}
        <button type="button" onClick={() => onImport(step.boardId)}>
          <span className="nb-setup-body"><b>Import a layout</b><small>{importLine(board)}</small></span>
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
      {flow.removed === null ? null : (
        <RestoreKeyboard restore={() => flow.restoreKeyboard(step.boardId)} boardName={step.boardName} doing="start this config" onRestored={startBlank} />
      )}
      {flow.problem === null ? null : <p className="nb-problem" role="alert">{flow.problem}</p>}
      <footer className="nb-foot">
        <span className="nb-note">{setupFoot(firmware, step.keyboard !== null)}</span>
        <button type="button" className="sheet-action" onClick={flow.notNow}>Not now</button>
      </footer>
    </section>
  );
}
