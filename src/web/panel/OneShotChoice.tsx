import { useId } from "react";
import { keptDefinitions } from "../../layout/kept-behaviours.ts";
import { oneShotRefusal } from "../../layout/one-shot-mods.ts";
import type { Firmware, Layout, Mod } from "../../layout/schema.ts";
import { openPlace } from "../shell/open-place.ts";

// "For the next key only" on a modifier key (D-568), with the words and mark the layer key's choice uses. A firmware that can't hold
// these modifiers for one key keeps the choice in view, off, with why and what to change beside it.
export function OneShotChoice({ mods, on, firmware, passthrough = [], onChange }: { mods: readonly Mod[]; on: boolean; firmware: Firmware; passthrough?: Layout["passthrough"]; onChange: (on: boolean) => void }) {
  const noteId = useId();
  const refusal = oneShotRefusal(mods, firmware, keptDefinitions(passthrough));
  // Turned on, a refusal is the reason beside Apply, and the choice stays pressable so it can be turned off again.
  const blocked = !on && refusal !== null;
  return (
    <div className="card-oneshot">
      <button type="button" className="card-slot-add" aria-pressed={on} disabled={blocked} aria-describedby={blocked ? noteId : undefined} onClick={() => onChange(!on)}>
        <span className="card-oneshot-mark" aria-hidden="true">1×</span> For the next key only
      </button>
      {blocked ? (
        <p id={noteId} className="card-oneshot-note">{refusal}</p>
      ) : on && refusal === null && firmware === "qmk" ? (
        <p className="card-oneshot-note">
          How long it waits for that key is the one-shot timeout, in{" "}
          <button type="button" className="link-button" onClick={() => openPlace("settings")}>Settings</button>.
        </p>
      ) : null}
    </div>
  );
}
