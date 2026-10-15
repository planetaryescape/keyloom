// Edits to a layer's LED colours (D-190), as the settings page and the key panel make them. Pure, so the rules are tested
// without a browser: what a colour choice does to the layer's lighting, and the ops and words for a staged set of them.
import type { ChangeOp } from "../../layout/change.ts";
import { colourName, isDark } from "../../layout/colour.ts";
import { deepEqual } from "../../layout/equal.ts";
import type { Hsv, Layout, LayerLighting } from "../../layout/schema.ts";

/** Layer id -> the lighting it should have; null clears it. A layer that is not in the map is unedited. */
export type LightingDraft = ReadonlyMap<string, LayerLighting | null>;

/** Dark means "no colour" for the layer as a whole, so it is dropped: the keys with their own colours still show. */
export function withLayerColour(current: LayerLighting | undefined, colour: Hsv): LayerLighting {
  const { layer: _gone, ...rest } = current ?? {};
  return isDark(colour) ? rest : { ...rest, layer: colour };
}

/** `colour` null puts the key back to following its layer. */
export function withKeyColour(current: LayerLighting | undefined, position: number, colour: Hsv | null): LayerLighting {
  const keys = { ...(current?.keys ?? {}) };
  if (colour === null) delete keys[String(position)];
  else keys[String(position)] = colour;
  const { keys: _gone, ...rest } = current ?? {};
  return Object.keys(keys).length === 0 ? rest : { ...rest, keys };
}

/** The lighting each edited layer would have, ignoring edits that change nothing. */
export function effectiveDraft(layout: Layout, draft: LightingDraft): Map<string, LayerLighting | null> {
  const out = new Map<string, LayerLighting | null>();
  for (const [layerId, lighting] of draft) {
    const layer = layout.layers.find((l) => l.id === layerId);
    if (layer !== undefined && !deepEqual(layer.lighting ?? null, lighting)) out.set(layerId, lighting);
  }
  return out;
}

export const lightingOps = (layout: Layout, draft: LightingDraft): ChangeOp[] =>
  [...effectiveDraft(layout, draft)].map(([layerId, lighting]) => ({ op: "setLayerLighting", layerId, lighting }));

/** The layout as it would look with the staged colours, for the board to draw before they are applied. */
export function withLighting(layout: Layout, draft: LightingDraft): Layout {
  if (draft.size === 0) return layout;
  return {
    ...layout,
    layers: layout.layers.map((layer) => {
      if (!draft.has(layer.id)) return layer;
      const lighting = draft.get(layer.id);
      const { lighting: _old, ...rest } = layer;
      return lighting === null || lighting === undefined ? rest : { ...rest, lighting };
    }),
  };
}

/** "Nav blue", "Base colours cleared" for the history line. */
export function lightingWords(layout: Layout, draft: LightingDraft): string[] {
  return [...effectiveDraft(layout, draft)].map(([layerId, lighting]) => {
    const name = layout.layers.find((l) => l.id === layerId)?.name ?? layerId;
    if (lighting === null) return `${name} colours cleared`;
    const keys = Object.keys(lighting.keys ?? {}).length;
    const base = lighting.layer === undefined ? "dark" : colourName(lighting.layer);
    return `${name} ${base}${keys === 0 ? "" : ` with ${keys} ${keys === 1 ? "key" : "keys"} coloured`}`;
  });
}
