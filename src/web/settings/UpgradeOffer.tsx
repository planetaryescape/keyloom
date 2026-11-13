import { EyeOff, LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { FailureNote } from "../shell/UnexpectedWayOut.tsx";
import { type PageFailure, failsAgain } from "../shell/unexpected.ts";
import { upgradeFailure, upgradeRefused } from "./upgrade-words.ts";
import "./settings.css";

interface Props {
  offer: { colours: boolean; tapDances: boolean };
  /** Shows the updated layout; throws when the update wasn't made. A failed read after it is the Viewer's to say (R6-03). */
  onUpgrade: () => Promise<void>;
  /** The session token, for Restart keyloom beside a failure no screen planned for. */
  token: string;
  /** True once keyloom's check turned the update down for this version of the layout. The Viewer keeps it, so every place the offer shows agrees. */
  refused: boolean;
  onRefused: () => void;
  /** Hides the offer until the layout changes. */
  onHide: () => void;
}

const WORDS = (o: Props["offer"]) => (o.colours && o.tapDances ? "Oryx colours and tap dances" : o.colours ? "Oryx colours" : "Oryx tap dances");

// A stored layout still holds some Oryx code that keyloom can now edit (D-193). This is the only way it gets read into the
// model: keyloom never rewrites a layout until the button is pressed, and the result is one revision that undoes.
export function UpgradeOffer({ offer, onUpgrade, token, refused, onRefused, onHide }: Props) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<PageFailure | null>(null);
  async function run() {
    setBusy(true);
    setProblem(null);
    try {
      await onUpgrade();
    } catch (error) {
      const failure = upgradeFailure(error);
      if (failure.kind === "refused") onRefused();
      else setProblem(failure);
    } finally {
      setBusy(false);
    }
  }
  // The check runs on the same layout every time, so a refused update is never offered again as it was (R9-09): the person reads why and
  // hides the offer. An answer that fails the same way every time turns the button off, with Restart keyloom beside it.
  if (refused) {
    return (
      <div className="upgrade-offer" role="group" aria-label="Update layout">
        <p role="alert">{upgradeRefused(WORDS(offer))}</p>
        <button type="button" className="button" onClick={onHide}>
          <EyeOff size={14} aria-hidden="true" />
          Hide this
        </button>
      </div>
    );
  }
  const repeats = !failsAgain(problem);
  return (
    <div className="upgrade-offer" role="group" aria-label="Update layout">
      <p>This layout has {WORDS(offer)} keyloom can now edit.</p>
      <button type="button" className="button" disabled={busy || !repeats} onClick={() => void run()}>
        {busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
        Update layout
      </button>
      {problem === null ? null : <FailureNote token={token} failure={problem} className="upgrade-problem" />}
    </div>
  );
}
