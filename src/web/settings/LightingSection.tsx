import { useId } from "react";
import { hsvToHex, isDark } from "../../layout/colour.ts";
import type { Hsv, LayerLighting, Layout } from "../../layout/schema.ts";
import { ColourChoice } from "./ColourChoice.tsx";
import { type LightingDraft, withLayerColour } from "./lighting-ops.ts";

interface Props {
  layout: Layout;
  draft: LightingDraft;
  /** undefined drops the staged edit for the layer. */
  onChange: (layerId: string, lighting: LayerLighting | null | undefined) => void;
  currentLayerId: string;
  onShowLayer: (layerId: string) => void;
}

// What each layer lights the keys with while it is on top (D-190). Choosing a colour here stages it and the board draws it at
// once; Apply, at the foot of the page, saves it together with any other setting.
export function LightingSection({ layout, draft, onChange, currentLayerId, onShowLayer }: Props) {
  const heading = useId();
  return (
    <section className="settings-group" aria-labelledby={heading}>
      <h3 id={heading}>Layer colours</h3>
      <p className="muted settings-lead">
        The keys light in the colour of the layer on top. A layer with no colour leaves the keys to the keyboard&rsquo;s own light effect. One key can have its own colour from its panel.
      </p>
      {layout.layers.map((layer) => {
        const lighting = draft.has(layer.id) ? (draft.get(layer.id) ?? undefined) : layer.lighting;
        const colour: Hsv | null = lighting?.layer ?? null;
        const keys = Object.keys(lighting?.keys ?? {}).length;
        const status = lighting === undefined ? "No colour" : colour === null ? (keys === 0 ? "Dark" : "Only coloured keys") : null;
        return (
          <details key={layer.id} className="layer-colour" data-edited={draft.has(layer.id)} data-current={layer.id === currentLayerId}>
            <summary onClick={() => onShowLayer(layer.id)}>
              <span className="layer-colour-dot" style={colour === null || isDark(colour) ? undefined : { background: hsvToHex(colour) }} data-empty={colour === null} aria-hidden="true" />
              <span className="layer-colour-name">{layer.name}</span>
              <span className="muted">{status ?? "Coloured"}{keys > 0 ? `, ${keys} ${keys === 1 ? "key" : "keys"} on their own` : ""}</span>
            </summary>
            <ColourChoice label={`Colour for ${layer.name}`} value={colour} onChange={(next) => onChange(layer.id, withLayerColour(lighting, next))} />
            <div className="layer-colour-actions">
              {keys === 0 ? null : <button type="button" className="link-button" onClick={() => onChange(layer.id, { ...(lighting?.layer === undefined ? {} : { layer: lighting.layer }) })}>Clear the {keys === 1 ? "key colour" : "key colours"}</button>}
              {lighting === undefined ? null : <button type="button" className="link-button" onClick={() => onChange(layer.id, null)}>No colour for this layer</button>}
            </div>
          </details>
        );
      })}
    </section>
  );
}
