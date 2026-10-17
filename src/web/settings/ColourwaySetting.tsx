import type { Colourway } from "../../boards/schema.ts";

interface Props {
  boardName: string;
  colourways: readonly Colourway[];
  /** The pinned colourway's id, or null when the board follows the theme. */
  value: string | null;
  onChange: (id: string | null) => void;
}

// The drawn board's colourway (D-395): follow the theme, or keep the colours of the board on the desk. It changes only how keyloom
// draws the board, so it takes effect at once and is not part of the staged change that Apply sends.
export function ColourwaySetting({ boardName, colourways, value, onChange }: Props) {
  const options = [{ id: null, label: "Follow the theme" }, ...colourways.map((c) => ({ id: c.id, label: c.name }))];
  const chosen = colourways.find((c) => c.id === value);
  return (
    <section className="settings-group" aria-label="On screen">
      <h3>On screen</h3>
      <div className="setting">
        <div className="setting-head"><span id="colourway-label" className="setting-label">Your keyboard&rsquo;s colour</span></div>
        <div className="colourway-choice" role="radiogroup" aria-labelledby="colourway-label">
          {options.map((o) => (
            <button key={o.id ?? "theme"} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}>
              {o.id === null ? null : <i aria-hidden="true" data-case={colourways.find((c) => c.id === o.id)?.case} data-caps={colourways.find((c) => c.id === o.id)?.caps} />}
              {o.label}
            </button>
          ))}
        </div>
        <p>
          {chosen === undefined
            ? `The ${boardName} is drawn black in the dark theme and white in the light one.`
            : `The ${boardName} stays ${chosen.name.toLowerCase()}${chosen.maker === undefined ? "" : ` (${chosen.maker})`} in both themes, like the one on your desk.`}{" "}
          Only how keyloom draws it; nothing goes to the keyboard.
        </p>
      </div>
    </section>
  );
}
