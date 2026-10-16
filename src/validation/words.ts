// The pieces of the sentences written for people (D-101): a layer by its name and a key by what its cap prints, never an id, a
// zero-based position or a key number (D-279). Which key it is shows on the board: every issue also carries its slots.
import type { Slot } from "../layout/change.ts";
import { layerDisplayName } from "../layout/cap-words.ts";
import { bindingLegend } from "../layout/legend.ts";
import type { Layout } from "../layout/schema.ts";

export const layerName = (doc: Layout, layerId: string): string => {
  const name = doc.layers.find((l) => l.id === layerId)?.name;
  return name === undefined ? "a layer" : layerDisplayName(name);
};

/** What the key's cap prints on that layer: "⌫", "S hold ⌥", or null for a blank one. */
function printed(doc: Layout, s: Slot): string | null {
  const binding = doc.layers.find((l) => l.id === s.layerId)?.bindings[s.position];
  if (binding === undefined) return null;
  const legend = bindingLegend(binding, { layers: doc.layers, macros: doc.macros, tapDances: doc.tapDances });
  if (legend.tap === "" && legend.hold === undefined) return null;
  if (legend.hold === undefined) return legend.tap;
  return legend.kind === "holdTap" ? `${legend.tap} hold ${legend.hold}` : `${legend.tap} ${legend.hold}`;
}

/** "The ⌫ key on Layer 0", written to start a sentence. */
export const keyOn = (doc: Layout, s: Slot): string => {
  const what = printed(doc, s);
  return `${what === null ? "A blank key" : `The ${what} key`} on ${layerName(doc, s.layerId)}`;
};

/** "the ⌫ key on Layer 0", inside a sentence. */
export const keyIn = (doc: Layout, s: Slot): string => {
  const what = printed(doc, s);
  return `${what === null ? "a blank key" : `the ${what} key`} on ${layerName(doc, s.layerId)}`;
};
