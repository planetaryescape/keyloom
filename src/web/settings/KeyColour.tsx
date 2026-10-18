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
      <summary className="card-icon" aria-label={`Key LED colour: ${isDark(shown) ? "off" : own === null ? "the layer's" : "its own"}`} title="Key LED colour">
        <span className="layer-colour-dot" style={isDark(shown) ? undefined : { background: hsvToHex(shown) }} data-empty={isDark(shown)} aria-hidden="true" />
      </summary>
      <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0 }}>
        <p className="muted">This physical key&rsquo;s LED, not the on-screen layer colour.</p>
        <ColourChoice label={`LED colour for this key on ${layer.name}`} value={own} onChange={onPick} />
        {own === null ? null : <button type="button" className="link-button" onClick={() => onPick(null)}>Follow the layer LEDs</button>}
        {layer.lighting === undefined ? <p className="muted">{layer.name} has no LED colours yet, so the other keys on it go dark. Set the layer&rsquo;s LED lighting in Settings to light them.</p> : null}
      </fieldset>
    </details>
  );
}
