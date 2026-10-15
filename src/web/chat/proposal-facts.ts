// Plain-language facts about a proposal, read from the head layout: which keys it touches and
// whether it would overwrite a native binding (D-024), which keyloom can show but not rebuild.
import type { ProposalCard } from "../../api/http.ts";
import type { Slot } from "../../layout/change.ts";
import { describeKey } from "../../layout/describe.ts";
import type { Binding, Layout } from "../../layout/schema.ts";

export const slotKey = (slot: Slot): string => `${slot.layerId}:${slot.position}`;

export function layerName(layout: Layout, layerId: string): string {
  return layout.layers.find((layer) => layer.id === layerId)?.name ?? layerId;
}

/** "Nav, key 33": positions are zero-based in the model and one-based on screen, like the board's labels. */
export function slotName(layout: Layout, slot: Slot): string {
  return `${layerName(layout, slot.layerId)}, key ${slot.position + 1}`;
}

/** What a key prints, for chips: "S", "Esc", or "empty". */
export function keyLabel(layout: Layout, slot: Slot): string {
  const layerIndex = layout.layers.findIndex((layer) => layer.id === slot.layerId);
  if (layerIndex < 0) return "?";
  const tap = describeKey(layout, layerIndex, slot.position)?.legend.tap ?? "";
  return tap === "" ? "empty" : tap;
}

export type ReplacedNative = { slot: Slot; binding: Extract<Binding, { kind: "native" }> };

/** The native bindings a proposal's changed keys would overwrite. */
export function replacedNatives(layout: Layout, proposal: ProposalCard): ReplacedNative[] {
  return proposal.validation.diff.changed.flatMap((slot) => {
    const binding = layout.layers.find((layer) => layer.id === slot.layerId)?.bindings[slot.position];
    return binding?.kind === "native" ? [{ slot, binding }] : [];
  });
}
