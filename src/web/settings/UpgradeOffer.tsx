import { LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import "./settings.css";

interface Props {
  offer: { colours: boolean; tapDances: boolean };
  /** Resolves once the new layout is on screen; throws with a sentence for the person when it can't be done. */
  onUpgrade: () => Promise<void>;
}

const WORDS = (o: Props["offer"]) => (o.colours && o.tapDances ? "Oryx colours and tap dances" : o.colours ? "Oryx colours" : "Oryx tap dances");

// A stored layout still holds some Oryx code that keyloom can now edit (D-193). This is the only way it gets read into the
// model: keyloom never rewrites a layout until the button is pressed, and the result is one revision that undoes.
export function UpgradeOffer({ offer, onUpgrade }: Props) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setProblem(null);
    try {
      await onUpgrade();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The layout could not be updated.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="upgrade-offer" role="group" aria-label="Update layout">
      <p>This layout has {WORDS(offer)} keyloom can now edit.</p>
      <button type="button" className="button" disabled={busy} onClick={() => void run()}>
        {busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
        Update layout
      </button>
      {problem === null ? null : <p className="upgrade-problem" role="alert">{problem}</p>}
    </div>
  );
}
