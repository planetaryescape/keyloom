import { Search, Usb, X } from "lucide-react";
import type { ApiCandidate } from "../../api/detected-keyboards.ts";
import type { NewKeyboard } from "./useNewKeyboard.ts";
import "./keyboards.css";

/** "Likely" for a candidate keyloom is sure of, "One of two" when it isn't sure, "Maybe" for a long shot. */
function confidenceWord(c: ApiCandidate, ambiguous: boolean, count: number): { text: string; tone: "sure" | "maybe" } {
  if (ambiguous) return { text: count === 2 ? "One of two" : "Maybe", tone: "maybe" };
  return c.confidence >= 0.6 ? { text: "Likely", tone: "sure" } : { text: "Maybe", tone: "maybe" };
}

/** A candidate's detail in words: "ZMK shield · 2 halves · needs a pro_micro controller". */
const detailWords = (c: ApiCandidate): string => `${c.firmware.toUpperCase()} ${c.detail.replace(/, /g, " · ")}`;

// The stage card (n1, D-336): a keyboard keyloom has no board for was plugged in. It says what USB said, lists what it could be with
// keyloom's reasons, and asks once; an ambiguous one has nothing chosen. Every choice is on screen: the candidates, the search, the buttons.
export function NewKeyboardCard({ flow }: { flow: NewKeyboard }) {
  const { step } = flow;
  if (step.kind !== "card") return null;
  const k = step.keyboard;
  const candidates = [...k.candidates, ...flow.found.filter((f) => !k.candidates.some((c) => c.id === f.id))];
  const chosen = candidates.find((c) => c.id === step.choice);
  return (
    <section className="nb-card" aria-label="A keyboard keyloom hasn't met">
      <header className="nb-card-head">
        <div>
          <p className="nb-eyebrow"><Usb size={13} aria-hidden="true" />Just plugged in</p>
          <h2>A keyboard keyloom hasn't met</h2>
        </div>
        <button type="button" className="sheet-close" aria-label="Not now" onClick={flow.notNow}><X size={16} aria-hidden="true" /></button>
      </header>
      <p className="nb-lead">
        It calls itself <b>“{k.device.product}”</b> ({k.device.maker}, {k.device.vendorId}:{k.device.productId}).{" "}
        {k.candidates.length === 0
          ? "keyloom's list has nothing by that name. Search for it below."
          : k.ambiguous
            ? "keyloom can't tell which of these it is, so it won't guess. Which is yours?"
            : "Here's what it could be. Pick the one it is; keyloom doesn't guess for you."}
      </p>
      <div className="nb-cands" role="radiogroup" aria-label="Which keyboard it is">
        {candidates.map((c) => {
          const word = confidenceWord(c, k.ambiguous, k.candidates.length);
          return (
            <button key={c.id} type="button" role="radio" aria-checked={step.choice === c.id} className="nb-cand" onClick={() => flow.choose(c.id)}>
              <i aria-hidden="true" />
              <span className="nb-cand-body">
                <b>{c.displayName}</b>
                <small>{detailWords(c)}</small>
                {c.reasons.length === 0 ? null : <ul>{c.reasons.map((r) => <li key={r}>{r.charAt(0).toUpperCase() + r.slice(1)}.</li>)}</ul>}
              </span>
              {k.candidates.includes(c) ? <span className="nb-pill" data-tone={word.tone}>{word.text}</span> : <span className="nb-pill" data-tone="maybe">From search</span>}
            </button>
          );
        })}
      </div>
      <label className="nb-search">
        <Search size={14} aria-hidden="true" />
        <input type="search" value={flow.searchText} placeholder={k.candidates.length === 0 ? "Search QMK's and ZMK's keyboards by name" : "Not on the list? Search by name"} onChange={(e) => void flow.search(e.target.value)} />
      </label>
      {flow.problem === null ? null : <p className="nb-problem" role="alert">{flow.problem}</p>}
      <footer className="nb-foot">
        <span className="nb-note">keyloom only reads it. Nothing is written to the keyboard.</span>
        <button type="button" className="sheet-action" onClick={flow.notNow}>Not now</button>
        <button type="button" className="bar-apply" disabled={chosen === undefined} onClick={flow.confirmCandidate}>
          {chosen === undefined ? "Choose one" : `It's a ${chosen.displayName.replace(/ \(new\)$/, "")}`}
        </button>
      </footer>
    </section>
  );
}
