// The pieces of the sentences written for people (D-101): a layer by its name and a key by its
// one-based number, never an id or a zero-based position.
import type { Slot } from "../layout/change.ts";
import type { Layout } from "../layout/schema.ts";

export const layerName = (doc: Layout, layerId: string): string => doc.layers.find((l) => l.id === layerId)?.name ?? "a layer";

/** "Key 7 on Layer 0", written to start a sentence. */
export const keyOn = (doc: Layout, s: Slot): string => `Key ${s.position + 1} on ${layerName(doc, s.layerId)}`;

/** "Layer 0, key 7": the form the older sentences use. */
export const keyIn = (doc: Layout, s: Slot): string => `${layerName(doc, s.layerId)}, key ${s.position + 1}`;
