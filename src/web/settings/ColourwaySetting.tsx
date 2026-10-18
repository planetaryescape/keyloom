import type { CapColour, CaseColour, Colourways } from "../../boards/schema.ts";
import type { Pinned } from "../keyboard/colourway.ts";
import { useRoom } from "../shell/theme.ts";

interface Props {
  boardName: string;
  colourways: Colourways;
  /** The pinned case and caps by id; null where a part follows the theme. */
  value: Pinned;
  onChange: (part: "case" | "caps", id: string | null) => void;
}

const named = (c: { name: string; maker?: string | undefined }) => `${c.name.toLowerCase()}${c.maker === undefined || c.maker.toLowerCase() === c.name.toLowerCase() ? "" : ` (${c.maker})`}`;

// The drawn board's colours (D-395, D-319): the case and the keycaps, each following the theme or kept at the colour of the board on the
// desk, in any mix the maker sells. It changes only how keyloom draws the board, so it takes effect at once and is not part of the
// staged change that Apply sends.
export function ColourwaySetting({ boardName, colourways, value, onChange }: Props) {
  const room = useRoom();
  const kase = colourways.cases.find((c) => c.id === value.case);
  const caps = colourways.caps.find((c) => c.id === value.caps);
  // The swatch shows the whole board as each choice would draw it: the other part as it is now.
  const caseTone = kase?.tone ?? room;
  const capsTone = caps?.tone ?? room;

  const row = <T extends CaseColour | CapColour>(part: "case" | "caps", label: string, options: readonly T[], chosen: string | null) => (
    <div className="colourway-row">
      <span id={`colourway-${part}`} className="colourway-part">{label}</span>
      <div className="colourway-choice" role="radiogroup" aria-labelledby={`colourway-${part}`}>
        <button type="button" role="radio" aria-checked={chosen === null} onClick={() => onChange(part, null)}>Follow the theme</button>
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={chosen === o.id} onClick={() => onChange(part, o.id)}>
            <i aria-hidden="true" data-case={part === "case" ? o.tone : caseTone} data-caps={part === "caps" ? o.tone : capsTone} />
            {o.name}
          </button>
        ))}
      </div>
    </div>
  );

  const words =
    kase === undefined && caps === undefined
      ? `The ${boardName} is drawn black in the dark theme and white in the light one.`
      : kase !== undefined && caps !== undefined
        ? `The ${boardName} is drawn with a ${named(kase)} case and ${named(caps)} keycaps in both themes, like the one on your desk.`
        : kase !== undefined
          ? `The ${boardName}'s case stays ${named(kase)} in both themes; its keycaps follow the theme.`
          : `The ${boardName}'s keycaps stay ${named(caps as CapColour)} in both themes; its case follows the theme.`;

  return (
    <section className="settings-group" aria-label="On screen">
      <h3>On screen</h3>
      <div className="setting">
        <div className="setting-head"><span className="setting-label">Your keyboard&rsquo;s colours</span></div>
        {row("case", "Case", colourways.cases, value.case)}
        {row("caps", "Keycaps", colourways.caps, value.caps)}
        <p>{words} Only how keyloom draws it; nothing goes to the keyboard.</p>
      </div>
    </section>
  );
}
