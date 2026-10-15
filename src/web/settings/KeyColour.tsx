import { Palette } from "lucide-react";
import { colourAt, hsvToHex, isDark } from "../../layout/colour.ts";
import type { Hsv, Layer } from "../../layout/schema.ts";
import { ColourChoice } from "./ColourChoice.tsx";
import "./settings.css";

interface Props {
  layer: Layer;
  position: number;
  /** Applies at once, as its own change. */
  onPick: (colour: Hsv | null) => void;
  busy: boolean;
}

// One key's LED colour, beside Swap, Copy and Paste in the key panel's footer (D-192). It saves on its own, not with the
// key's binding, because a colour has nothing to do with what the key sends.
export function KeyColour({ layer, position, onPick, busy }: Props) {
  const own = layer.lighting?.keys?.[String(position)] ?? null;
  const shown = colourAt(layer, position);
  return (
    <details className="key-colour">
      <summary>
        <Palette size={14} aria-hidden="true" />
        Colour
        <span className="layer-colour-dot" style={isDark(shown) ? undefined : { background: hsvToHex(shown) }} data-empty={isDark(shown)} aria-hidden="true" />
      </summary>
      <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0 }}>
        <ColourChoice label={`Colour for this key on ${layer.name}`} value={own} onChange={onPick} />
        {own === null ? null : <button type="button" className="link-button" onClick={() => onPick(null)}>Follow the layer</button>}
        {layer.lighting === undefined ? <p className="muted">{layer.name} has no colours yet, so the other keys on it go dark. Colour the layer in Settings to light them.</p> : null}
      </fieldset>
    </details>
  );
}
