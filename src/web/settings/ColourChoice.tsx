import { Ban } from "lucide-react";
import { useId } from "react";
import { SWATCHES, colourName, hexToHsv, hsvToHex, isDark } from "../../layout/colour.ts";
import type { Hsv } from "../../layout/schema.ts";

interface Props {
  /** The colour now in force; null when none is chosen. */
  value: Hsv | null;
  onChange: (colour: Hsv) => void;
  /** What the group is for, for the screen reader ("Colour for Nav"). */
  label: string;
  /** Offered when the colour can be dark on purpose. */
  allowOff?: boolean;
}

// The swatches Oryx's own hues give, then any colour from the browser's picker. Every swatch has its name as its label,
// because a colour alone says nothing to a person who can't tell them apart (18#colour).
export function ColourChoice({ value, onChange, label, allowOff = true }: Props) {
  const custom = useId();
  const picked = value === null ? null : colourName(value);
  return (
    <div className="colour-choice" role="group" aria-label={label}>
      {SWATCHES.map((swatch) => (
        <button
          key={swatch.name}
          type="button"
          className="swatch"
          style={{ background: hsvToHex(swatch.hsv) }}
          aria-label={swatch.name}
          aria-pressed={picked === swatch.name.toLowerCase()}
          title={swatch.name}
          onClick={() => onChange(swatch.hsv)}
        />
      ))}
      {allowOff ? (
        <button type="button" className="swatch swatch-off" aria-label="Off" aria-pressed={value !== null && isDark(value)} title="Off, dark" onClick={() => onChange([0, 0, 0])}>
          <Ban size={14} aria-hidden="true" />
        </button>
      ) : null}
      <label className="swatch-custom" htmlFor={custom}>
        <span>Other</span>
        <input
          id={custom}
          type="color"
          value={value === null || isDark(value) ? "#ffffff" : hsvToHex(value)}
          onChange={(event) => {
            const hsv = hexToHsv(event.target.value);
            if (hsv !== null) onChange(hsv);
          }}
        />
      </label>
    </div>
  );
}
